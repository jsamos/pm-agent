/**
 * Tool: generate_epic_narrative
 * Reads the last group_issues result from toolCallLog and generates
 * a prose narrative for the epic using a dedicated LLM call.
 *
 * Architecture: LLM writes prose with inline issue citations (as JSON).
 * Code assembles the final markdown from section paragraphs.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import type { GroupIssuesResult, IssueGroup } from "./group-issues.js";
import type { JiraIssue } from "./search-issues.js";
import { getToolModel } from "../../lib/models.js";
import { extractDiffFromLog, formatDiffBlock } from "./format-diff.js";
import { trace } from "../../lib/agent-loop.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, "../../prompts/epic-narrative.md"), "utf-8").trim();

const DEFAULT_DESC_LIMIT = 1000;

interface ClassifiedIssue {
  key: string;
  summary: string;
  assignee: string | null;
  description: string | null;
}

export interface EpicNarrativeParsed {
  sectionType?: string;
  section?: string;
  done?: string[];
  inMotion?: string[];
  notStarted?: string[];
}

export function assembleEpicMarkdown(
  parsed: EpicNarrativeParsed,
  counts: { done: number; inMotion: number; notStarted: number },
): string {
  const md: string[] = [];

  if (parsed.section) {
    const heading = parsed.sectionType === "unlock" ? "Unlock" : "Outcome";
    md.push(`## ${heading}\n\n${parsed.section}`);
  }

  if (parsed.done && parsed.done.length > 0 && counts.done > 0) {
    md.push(`## What's Been Done\n\n${parsed.done.join("\n\n")}`);
  }

  if (parsed.inMotion && parsed.inMotion.length > 0 && counts.inMotion > 0) {
    md.push(`## What's In Motion\n\n${parsed.inMotion.join("\n\n")}`);
  }

  if (parsed.notStarted && parsed.notStarted.length > 0 && counts.notStarted > 0) {
    md.push(`## What's Not Started\n\n${parsed.notStarted.join("\n\n")}`);
  }

  return md.join("\n\n---\n\n");
}

function extractJson(raw: string): string {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) text = fenceMatch[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

export const generateEpicNarrativeTool: Tool = {
  name: "generate_epic_narrative",
  description:
    "Generate a prose narrative for an epic from the last group_issues result (expects groupBy: 'status'). Uses a dedicated LLM call with writing-principles prompt. Returns markdown.",
  parameters: {
    type: "object",
    properties: {},
  },

  async execute(_args, context: ExecutionContext) {
    const log = context.toolCallLog;
    if (!log || log.length === 0) {
      throw new Error("No tool call log available — run group_issues first.");
    }

    const groupEntry = [...log].reverse().find((tc) => tc.tool === "group_issues");
    if (!groupEntry) {
      throw new Error("No group_issues result found in tool call log. Run group_issues first.");
    }

    const grouped = groupEntry.result as GroupIssuesResult;
    if (!grouped.groups || grouped.groups.length === 0) {
      throw new Error("group_issues result has no groups.");
    }

    const getSubGroup = (group: IssueGroup, key: string): JiraIssue[] =>
      group.subGroups?.find((s) => s.groupKey === key)?.issues || [];

    const done = grouped.groups.flatMap((g) => getSubGroup(g, "done"));
    const inMotion = grouped.groups.flatMap((g) => getSubGroup(g, "in_progress"));
    const notStarted = grouped.groups.flatMap((g) => getSubGroup(g, "not_started"));

    const jiraBase = ((context.config.issueLinkBase as string) || "https://your-org.atlassian.net/browse").replace(/\/+$/, "");
    const narrativeCfg = (context.config.narrative as Record<string, unknown>) || {};
    const descLimit = (narrativeCfg.descriptionLimit as number) || DEFAULT_DESC_LIMIT;

    const formatIssueData = (i: JiraIssue) => {
      const desc = i.description ? i.description.slice(0, descLimit) : "(no description)";
      return `- ${i.key} (${i.assignee || "Unassigned"}) [Status: ${i.status}]: ${i.summary}\n  ${desc}`;
    };

    const dataSections: string[] = [`JIRA_BASE: ${jiraBase}`];

    if (done.length > 0) {
      dataSections.push(`DONE (${done.length}):\n${done.map(formatIssueData).join("\n")}`);
    }
    if (inMotion.length > 0) {
      dataSections.push(`IN MOTION (${inMotion.length}):\n${inMotion.map(formatIssueData).join("\n")}`);
    }
    if (notStarted.length > 0) {
      dataSections.push(`NOT STARTED (${notStarted.length}):\n${notStarted.map(formatIssueData).join("\n")}`);
    }

    const userMessage = dataSections.join("\n\n");

    const llmStart = Date.now();
    const response = await context.llm.generate([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ], { model: getToolModel("generate_epic_narrative"), temperature: 0.3 });
    const llmMs = Date.now() - llmStart;

    const raw = response.content || "";
    trace("inner_llm_call", {
      tool: "generate_epic_narrative",
      ms: llmMs,
      response: raw.slice(0, 2000),
    });

    const jsonStr = extractJson(raw);

    let parsed: EpicNarrativeParsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      process.stderr.write(`  [warn] generate_epic_narrative: JSON parse failed — ${(e as Error).message}\n`);
      trace("inner_llm_parse_error", { tool: "generate_epic_narrative", error: (e as Error).message, raw: raw.slice(0, 1000) });
      return { narrative: raw };
    }

    let narrative = assembleEpicMarkdown(parsed, {
      done: done.length,
      inMotion: inMotion.length,
      notStarted: notStarted.length,
    });

    const diff = log ? extractDiffFromLog(log) : null;
    if (diff) {
      const diffBlock = formatDiffBlock(diff, jiraBase);
      if (diffBlock) narrative = diffBlock + "\n\n" + narrative;
    }

    return {
      narrative,
      summary: `Narrative generated (${done.length} done, ${inMotion.length} in motion, ${notStarted.length} not started). Full content available via contentFrom: "generate_epic_narrative".`,
    };
  },
};
