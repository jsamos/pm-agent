/**
 * Shared structured-output LLM calls for narrative tools.
 * Uses tool-use input (provider-parsed) with JSON-text fallback.
 *
 * Vocabulary (aligned end-to-end): done / inProgress / notStarted
 */

import type { LLM, LLMResponse, ToolDefinition } from "./llm.js";
import { extractJson } from "./extract-json.js";
import { trace } from "./agent-loop.js";

export const SUBMIT_NARRATIVE_TOOL: ToolDefinition = {
  name: "submit_narrative",
  description: "Submit the prose narrative for one sprint group or epic.",
  parameters: {
    type: "object",
    properties: {
      groupKey: {
        type: "string",
        description: "Exact group key from the input (sprint groups only; omit for epic-only calls).",
      },
      sectionType: {
        type: "string",
        description: "Epic only: outcome or unlock.",
      },
      section: {
        type: "string",
        description: "Epic only: 2-4 sentences describing what the epic achieves.",
      },
      done: {
        type: "array",
        items: { type: "string" },
        description: "Paragraphs for done work with inline issue citations.",
      },
      inProgress: {
        type: "array",
        items: { type: "string" },
        description: "Paragraphs for in-progress work with inline issue citations.",
      },
      notStarted: {
        type: "array",
        items: { type: "string" },
        description: "Paragraphs for not-started work with inline issue citations.",
      },
    },
  },
};

/** @deprecated use SUBMIT_NARRATIVE_TOOL */
export const SUBMIT_GROUP_NARRATIVE_TOOL = SUBMIT_NARRATIVE_TOOL;
/** @deprecated use SUBMIT_NARRATIVE_TOOL */
export const SUBMIT_EPIC_NARRATIVE_TOOL = SUBMIT_NARRATIVE_TOOL;

const SUBMIT_TOOL_NAMES = new Set([
  SUBMIT_NARRATIVE_TOOL.name,
  "submit_group_narrative",
  "submit_epic_narrative",
]);

export interface NarrativeFields {
  groupKey?: string;
  sectionType?: string;
  section?: string;
  done?: string[];
  inProgress?: string[];
  notStarted?: string[];
}

/** @deprecated use NarrativeFields */
export type GroupNarrativeFields = NarrativeFields & { groupKey: string };

/** @deprecated use NarrativeFields */
export type EpicNarrativeFields = NarrativeFields;

export interface ExpectedNarrativeSections {
  done: number;
  inProgress: number;
  notStarted: number;
}

export function isNarrativeComplete(
  parsed: NarrativeFields,
  expected: ExpectedNarrativeSections,
): boolean {
  if (expected.done > 0 && (!parsed.done || parsed.done.length === 0)) return false;
  if (expected.inProgress > 0 && (!parsed.inProgress || parsed.inProgress.length === 0)) return false;
  if (expected.notStarted > 0 && (!parsed.notStarted || parsed.notStarted.length === 0)) return false;
  return true;
}

/** Keep non-empty prose arrays from either attempt (used after retry). */
export function mergeNarrativeFields(a: NarrativeFields, b: NarrativeFields): NarrativeFields {
  return {
    groupKey: a.groupKey || b.groupKey,
    sectionType: a.sectionType || b.sectionType,
    section: a.section || b.section,
    done: a.done?.length ? a.done : b.done,
    inProgress: a.inProgress?.length ? a.inProgress : b.inProgress,
    notStarted: a.notStarted?.length ? a.notStarted : b.notStarted,
  };
}

function proseFieldCounts(args: Record<string, unknown>): Record<string, number> {
  return {
    done: asStringArray(args.done)?.length ?? 0,
    inProgress: asStringArray(args.inProgress)?.length ?? 0,
    notStarted: asStringArray(args.notStarted)?.length ?? 0,
  };
}

/** @deprecated use isNarrativeComplete */
export const isGroupNarrativeComplete = isNarrativeComplete;

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function fromToolArguments(args: Record<string, unknown>, fallbackGroupKey?: string): NarrativeFields {
  const groupKey = typeof args.groupKey === "string" && args.groupKey.trim()
    ? args.groupKey.trim()
    : fallbackGroupKey;

  return {
    ...(groupKey ? { groupKey } : {}),
    sectionType: typeof args.sectionType === "string" ? args.sectionType : undefined,
    section: typeof args.section === "string" ? args.section : undefined,
    done: asStringArray(args.done),
    inProgress: asStringArray(args.inProgress),
    notStarted: asStringArray(args.notStarted),
  };
}

function findNarrativeToolCall(response: LLMResponse) {
  return response.toolCalls.find((tc) => SUBMIT_TOOL_NAMES.has(tc.name));
}

export function parseNarrativeResponse(
  response: LLMResponse,
  fallbackGroupKey?: string,
): { parsed: NarrativeFields; source: "tool" | "json" | "fallback" } {
  const toolCall = findNarrativeToolCall(response);
  if (toolCall) {
    return { parsed: fromToolArguments(toolCall.arguments, fallbackGroupKey), source: "tool" };
  }

  const raw = response.content || "";
  if (raw.trim()) {
    try {
      const parsed = fromToolArguments(JSON.parse(extractJson(raw)) as Record<string, unknown>, fallbackGroupKey);
      return { parsed, source: "json" };
    } catch {
      // fall through
    }
  }

  return { parsed: fallbackGroupKey ? { groupKey: fallbackGroupKey } : {}, source: "fallback" };
}

/** @deprecated use parseNarrativeResponse */
export function parseGroupNarrativeResponse(
  response: LLMResponse,
  fallbackGroupKey: string,
): { parsed: NarrativeFields; source: "tool" | "json" | "fallback" } {
  return parseNarrativeResponse(response, fallbackGroupKey);
}

/** @deprecated use parseNarrativeResponse */
export function parseEpicNarrativeResponse(
  response: LLMResponse,
): { parsed: NarrativeFields; source: "tool" | "json" | "fallback" } {
  return parseNarrativeResponse(response);
}

export async function callStructuredNarrativeLlm<T>(options: {
  llm: LLM;
  tracingTool: string;
  systemPrompt: string;
  userMessage: string;
  tools: ToolDefinition[];
  model: string;
  traceLabel: string;
  maxTokens: number;
  temperature: number;
  parseResponse: (response: LLMResponse) => { parsed: T; source: "tool" | "json" | "fallback" };
  isComplete?: (parsed: T) => boolean;
}): Promise<T> {
  const submitToolName = SUBMIT_NARRATIVE_TOOL.name;

  async function invoke(userMessage: string, attempt: number): Promise<{ parsed: T; source: "tool" | "json" | "fallback"; ms: number }> {
    trace("inner_llm_request", {
      tool: options.tracingTool,
      groupKey: options.traceLabel,
      attempt,
      userMessage: userMessage.slice(0, 2000),
    });

    const llmStart = Date.now();
    const response = await options.llm.generateWithTools(
      [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: userMessage },
      ],
      options.tools,
      {
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      },
    );
    const llmMs = Date.now() - llmStart;

    if (response.finishReason === "length") {
      process.stderr.write(
        `  [warn] ${options.tracingTool}: output truncated for "${options.traceLabel}" — increase maxTokens\n`,
      );
    }

    const raw = response.content || "";
    const narrativeToolCall = findNarrativeToolCall(response);
    trace("inner_llm_call", {
      tool: options.tracingTool,
      groupKey: options.traceLabel,
      attempt,
      ms: llmMs,
      response: raw.slice(0, 2000),
      toolCalls: response.toolCalls.map((tc) => tc.name),
      proseFields: narrativeToolCall ? proseFieldCounts(narrativeToolCall.arguments) : undefined,
    });

    process.stderr.write(`  [narrative] ${options.traceLabel} — ${llmMs}ms\n`);

    const { parsed, source } = options.parseResponse(response);
    return { parsed, source, ms: llmMs };
  }

  let { parsed, source } = await invoke(options.userMessage, 1);

  const incomplete = options.isComplete && !options.isComplete(parsed);
  if ((source === "fallback" || incomplete) && submitToolName) {
    const reason = source === "fallback" ? "no structured output" : "incomplete sections";
    process.stderr.write(
      `  [warn] ${options.tracingTool}: ${reason} for "${options.traceLabel}" — retrying\n`,
    );
    const retryMessage = `${options.userMessage}\n\nIMPORTANT: Call ${submitToolName} now with fields done, inProgress, notStarted. Include prose for every status section that has issues. Do not reply with analysis only.`;
    const retry = await invoke(retryMessage, 2);
    parsed = mergeNarrativeFields(parsed, retry.parsed);
    if (retry.source !== "fallback") source = retry.source;
  }

  if (source === "fallback") {
    process.stderr.write(
      `  [warn] ${options.tracingTool}: no structured output for "${options.traceLabel}" — using empty prose\n`,
    );
    trace("inner_llm_parse_error", {
      tool: options.tracingTool,
      groupKey: options.traceLabel,
      error: "No tool call and JSON parse failed after retry",
    });
  } else if (options.isComplete && !options.isComplete(parsed)) {
    process.stderr.write(
      `  [warn] ${options.tracingTool}: incomplete narrative for "${options.traceLabel}" after retry\n`,
    );
  }

  return parsed;
}
