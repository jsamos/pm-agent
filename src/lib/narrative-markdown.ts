/**
 * Markdown-first narrative LLM calls and section parsing.
 */

import type { LLM } from "./llm.js";
import { trace } from "./agent-loop.js";
import { NARRATIVE_HEADINGS } from "./narrative-headings.js";
import { buildQaLanguageHints } from "./roster-roles.js";
import type { JiraIssue } from "../tools/jira/search-issues.js";

export type StatusField = "done" | "inProgress" | "notStarted";

const HEADING_TO_FIELD: Record<string, StatusField> = {
  [NARRATIVE_HEADINGS.done]: "done",
  [NARRATIVE_HEADINGS.inProgress]: "inProgress",
  [NARRATIVE_HEADINGS.notStarted]: "notStarted",
};

export interface StatusCounts {
  done: number;
  inProgress: number;
  notStarted: number;
}

export function buildMarkdownExample(counts: StatusCounts): string {
  const lines = ["--- EXAMPLE OUTPUT (use this structure; omit sections with no issues) ---", ""];

  if (counts.done > 0) {
    lines.push(
      `${NARRATIVE_HEADINGS.done}`,
      "",
      "<paragraph covering every done issue with inline citations ([KEY](JIRA_BASE/KEY) · Assignee · Status)>",
      "",
    );
  }
  if (counts.inProgress > 0) {
    lines.push(
      `${NARRATIVE_HEADINGS.inProgress}`,
      "",
      "<paragraph covering every inProgress issue with inline citations>",
      "",
    );
  }
  if (counts.notStarted > 0) {
    lines.push(
      `${NARRATIVE_HEADINGS.notStarted}`,
      "",
      "<paragraph covering every notStarted issue with inline citations>",
      "",
    );
  }

  lines.push("Return markdown only. No JSON. No preamble.");
  return lines.join("\n");
}

export function appendMarkdownInstructions(
  userMessage: string,
  counts: StatusCounts,
  issues?: JiraIssue[],
): string {
  const parts = [userMessage];
  if (issues?.length) {
    const hints = buildQaLanguageHints(issues);
    if (hints) parts.push(hints);
  }
  parts.push(buildMarkdownExample(counts));
  return parts.join("\n\n");
}

/** Split unit markdown into status-section bodies (without ### headings). */
export function parseStatusSections(markdown: string): Partial<Record<StatusField, string>> {
  const result: Partial<Record<StatusField, string>> = {};
  if (!markdown.trim()) return result;

  for (const [heading, field] of Object.entries(HEADING_TO_FIELD)) {
    const pattern = new RegExp(
      `${escapeRegExp(heading)}\\s*\\n+([\\s\\S]*?)(?=\\n### |$)`,
      "i",
    );
    const match = markdown.match(pattern);
    if (match?.[1]?.trim()) {
      result[field] = match[1].trim();
    }
  }

  return result;
}

export function extractStatusSection(markdown: string, heading: string): string | undefined {
  const field = HEADING_TO_FIELD[heading];
  if (!field) return undefined;
  return parseStatusSections(markdown)[field];
}

export function missingIssueKeys(markdown: string, keys: string[]): string[] {
  return keys.filter((key) => !markdown.includes(key));
}

/** Convert legacy structured cache / test fixtures to unit markdown. */
export function legacyProseToMarkdown(prose: {
  done?: string[];
  inProgress?: string[];
  notStarted?: string[];
  delivered?: string[];
}): string {
  const parts: string[] = [];
  const done = prose.done ?? prose.delivered;
  if (done?.length) {
    parts.push(`${NARRATIVE_HEADINGS.done}\n\n${done.join("\n\n")}`);
  }
  if (prose.inProgress?.length) {
    parts.push(`${NARRATIVE_HEADINGS.inProgress}\n\n${prose.inProgress.join("\n\n")}`);
  }
  if (prose.notStarted?.length) {
    parts.push(`${NARRATIVE_HEADINGS.notStarted}\n\n${prose.notStarted.join("\n\n")}`);
  }
  return parts.join("\n\n");
}

export async function callMarkdownNarrativeLlm(options: {
  llm: LLM;
  tracingTool: string;
  systemPrompt: string;
  userMessage: string;
  model: string;
  traceLabel: string;
  maxTokens: number;
  temperature: number;
  requiredIssueKeys: string[];
}): Promise<string> {
  async function invoke(userMessage: string, attempt: number): Promise<string> {
    trace("inner_llm_request", {
      tool: options.tracingTool,
      groupKey: options.traceLabel,
      attempt,
      userMessage: userMessage.slice(0, 2000),
    });

    const llmStart = Date.now();
    const response = await options.llm.generate(
      [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: userMessage },
      ],
      {
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      },
    );
    const llmMs = Date.now() - llmStart;
    const markdown = (response.content || "").trim();

    trace("inner_llm_call", {
      tool: options.tracingTool,
      groupKey: options.traceLabel,
      attempt,
      ms: llmMs,
      response: markdown.slice(0, 2000),
      issueKeysFound: options.requiredIssueKeys.filter((k) => markdown.includes(k)),
    });

    process.stderr.write(`  [narrative] ${options.traceLabel} — ${llmMs}ms\n`);

    if (response.finishReason === "length") {
      process.stderr.write(
        `  [warn] ${options.tracingTool}: output truncated for "${options.traceLabel}" — increase maxTokens\n`,
      );
    }

    return markdown;
  }

  let markdown = await invoke(options.userMessage, 1);
  let missing = missingIssueKeys(markdown, options.requiredIssueKeys);

  if (!markdown || missing.length > 0) {
    const reason = !markdown ? "empty response" : `missing keys: ${missing.join(", ")}`;
    process.stderr.write(
      `  [warn] ${options.tracingTool}: ${reason} for "${options.traceLabel}" — retrying\n`,
    );
    const retryMessage = `${options.userMessage}\n\nIMPORTANT: Return markdown only. Every issue key MUST appear in a citation: ${options.requiredIssueKeys.join(", ")}.`;
    markdown = await invoke(retryMessage, 2);
    missing = missingIssueKeys(markdown, options.requiredIssueKeys);
  }

  if (!markdown) {
    process.stderr.write(
      `  [warn] ${options.tracingTool}: no markdown for "${options.traceLabel}" after retry\n`,
    );
    return "";
  }

  if (missing.length > 0) {
    process.stderr.write(
      `  [warn] ${options.tracingTool}: still missing keys after retry for "${options.traceLabel}": ${missing.join(", ")}\n`,
    );
  }

  return markdown;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
