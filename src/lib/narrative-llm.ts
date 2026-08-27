/**
 * Shared structured-output LLM calls for narrative tools.
 * Uses tool-use input (provider-parsed) with JSON-text fallback.
 */

import type { LLM, LLMResponse, ToolDefinition } from "./llm.js";
import { extractJson } from "./extract-json.js";
import { trace } from "./agent-loop.js";

export const SUBMIT_GROUP_NARRATIVE_TOOL: ToolDefinition = {
  name: "submit_group_narrative",
  description: "Submit the prose narrative for one sprint group.",
  parameters: {
    type: "object",
    properties: {
      groupKey: {
        type: "string",
        description: "Exact group key from the input (e.g. PROJ-100, Alice Martin).",
      },
      delivered: {
        type: "array",
        items: { type: "string" },
        description: "Paragraphs for delivered/done work with inline issue citations.",
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
    required: ["groupKey"],
  },
};

export const SUBMIT_EPIC_NARRATIVE_TOOL: ToolDefinition = {
  name: "submit_epic_narrative",
  description: "Submit the prose narrative for one epic.",
  parameters: {
    type: "object",
    properties: {
      sectionType: {
        type: "string",
        description: "outcome or unlock",
      },
      section: {
        type: "string",
        description: "2-4 sentences describing what this epic achieves.",
      },
      done: {
        type: "array",
        items: { type: "string" },
        description: "Paragraphs for completed work with inline issue citations.",
      },
      inMotion: {
        type: "array",
        items: { type: "string" },
        description: "Paragraphs for active work with inline issue citations.",
      },
      notStarted: {
        type: "array",
        items: { type: "string" },
        description: "Paragraphs for not-started work with inline issue citations.",
      },
    },
  },
};

export interface GroupNarrativeFields {
  groupKey: string;
  delivered?: string[];
  inProgress?: string[];
  notStarted?: string[];
}

export interface ExpectedNarrativeSections {
  delivered: number;
  inProgress: number;
  notStarted: number;
}

export function countExpectedSections(userMessage: string): ExpectedNarrativeSections {
  const counts = { delivered: 0, inProgress: 0, notStarted: 0 };
  const doneMatch = userMessage.match(/^\s*Done \((\d+)\):/m);
  const inProgressMatch = userMessage.match(/^\s*In Progress \((\d+)\):/m);
  const notStartedMatch = userMessage.match(/^\s*Not Started \((\d+)\):/m);
  if (doneMatch) counts.delivered = Number(doneMatch[1]);
  if (inProgressMatch) counts.inProgress = Number(inProgressMatch[1]);
  if (notStartedMatch) counts.notStarted = Number(notStartedMatch[1]);
  return counts;
}

export function isGroupNarrativeComplete(
  parsed: GroupNarrativeFields,
  expected: ExpectedNarrativeSections,
): boolean {
  if (expected.delivered > 0 && (!parsed.delivered || parsed.delivered.length === 0)) return false;
  if (expected.inProgress > 0 && (!parsed.inProgress || parsed.inProgress.length === 0)) return false;
  if (expected.notStarted > 0 && (!parsed.notStarted || parsed.notStarted.length === 0)) return false;
  return true;
}

export interface EpicNarrativeFields {
  sectionType?: string;
  section?: string;
  done?: string[];
  inMotion?: string[];
  notStarted?: string[];
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function fromGroupToolArguments(args: Record<string, unknown>, fallbackGroupKey: string): GroupNarrativeFields {
  const groupKey = typeof args.groupKey === "string" && args.groupKey.trim()
    ? args.groupKey.trim()
    : fallbackGroupKey;

  return {
    groupKey,
    delivered: asStringArray(args.delivered),
    inProgress: asStringArray(args.inProgress),
    notStarted: asStringArray(args.notStarted),
  };
}

function fromEpicToolArguments(args: Record<string, unknown>): EpicNarrativeFields {
  return {
    sectionType: typeof args.sectionType === "string" ? args.sectionType : undefined,
    section: typeof args.section === "string" ? args.section : undefined,
    done: asStringArray(args.done),
    inMotion: asStringArray(args.inMotion),
    notStarted: asStringArray(args.notStarted),
  };
}

export function parseGroupNarrativeResponse(
  response: LLMResponse,
  fallbackGroupKey: string,
): { parsed: GroupNarrativeFields; source: "tool" | "json" | "fallback" } {
  const toolCall = response.toolCalls.find((tc) => tc.name === SUBMIT_GROUP_NARRATIVE_TOOL.name);
  if (toolCall) {
    return { parsed: fromGroupToolArguments(toolCall.arguments, fallbackGroupKey), source: "tool" };
  }

  const raw = response.content || "";
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(extractJson(raw)) as GroupNarrativeFields;
      if (!parsed.groupKey) parsed.groupKey = fallbackGroupKey;
      return { parsed, source: "json" };
    } catch {
      // fall through
    }
  }

  return { parsed: { groupKey: fallbackGroupKey }, source: "fallback" };
}

export function parseEpicNarrativeResponse(
  response: LLMResponse,
): { parsed: EpicNarrativeFields; source: "tool" | "json" | "fallback" } {
  const toolCall = response.toolCalls.find((tc) => tc.name === SUBMIT_EPIC_NARRATIVE_TOOL.name);
  if (toolCall) {
    return { parsed: fromEpicToolArguments(toolCall.arguments), source: "tool" };
  }

  const raw = response.content || "";
  if (raw.trim()) {
    try {
      return { parsed: JSON.parse(extractJson(raw)) as EpicNarrativeFields, source: "json" };
    } catch {
      // fall through
    }
  }

  return { parsed: {}, source: "fallback" };
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
  const submitToolName = options.tools[0]?.name;

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
    trace("inner_llm_call", {
      tool: options.tracingTool,
      groupKey: options.traceLabel,
      attempt,
      ms: llmMs,
      response: raw.slice(0, 2000),
      toolCalls: response.toolCalls.map((tc) => tc.name),
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
    const retryMessage = `${options.userMessage}\n\nIMPORTANT: Call ${submitToolName} now. Include prose for every status section that has issues (delivered, inProgress, notStarted). Do not reply with analysis only.`;
    ({ parsed, source } = await invoke(retryMessage, 2));
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
