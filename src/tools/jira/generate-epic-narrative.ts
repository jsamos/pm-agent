/**
 * Tool: generate_epic_narrative
 * Reads the last group_issues result from toolCallLog and generates
 * a prose narrative for the epic using a dedicated LLM call.
 *
 * Architecture: LLM returns markdown; code assembles the page header.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import type { GroupIssuesResult } from "./group-issues.js";
import type { JiraIssue } from "./search-issues.js";
import { getToolLlmConfig } from "../../lib/models.js";
import { resolveDescriptionLimit } from "../../lib/narrative-config.js";
import {
  buildEpicMarkdownExample,
  callMarkdownNarrativeLlm,
} from "../../lib/narrative-markdown.js";
import { NARRATIVE_MESSAGE_LABELS } from "../../lib/narrative-headings.js";
import { extractDiffFromLog, formatDiffBlock } from "./format-diff.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, "../../prompts/epic-narrative.md"), "utf-8").trim();

export interface EpicHeader {
  key: string;
  summary: string;
  jiraBase: string;
  assignee?: string | null;
}

export function buildEpicMarkdownExample(counts: {
  done: number;
  inProgress: number;
  notStarted: number;
}): string {
  const lines = [
    "--- EXAMPLE OUTPUT (use this structure; omit sections with no issues) ---",
    "",
    "## Outcome",
    "",
    "<2-4 sentences on what this epic achieves>",
    "",
  ];

  if (counts.done > 0) {
    lines.push("## What's Been Done", "", "<paragraph with citations>", "");
  }
  if (counts.inProgress > 0) {
    lines.push("## What's In Motion", "", "<paragraph with citations>", "");
  }
  if (counts.notStarted > 0) {
    lines.push("## What's Not Started", "", "<paragraph with citations>", "");
  }

  lines.push("Return markdown only. No JSON. No preamble.");
  return lines.join("\n");
}

export function assembleEpicMarkdown(
  bodyMarkdown: string,
  header?: EpicHeader,
): string {
  const md: string[] = [];

  if (header) {
    md.push(`# ${header.summary}`);
    const link = `[${header.key}](${header.jiraBase}/${header.key})`;
    const assigneeLine = header.assignee ? `\n**Assignee:** ${header.assignee}` : "";
    md.push(link + assigneeLine);
  }

  if (bodyMarkdown.trim()) {
    md.push(bodyMarkdown.trim());
  }

  return md.join("\n\n---\n\n");
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

    const isSingleLevel = grouped.groupBy.length === 1 && grouped.groupBy[0] === "status";

    const getIssuesByStatus = (key: string): JiraIssue[] => {
      if (isSingleLevel) {
        return grouped.groups.find((g) => g.groupKey === key)?.issues || [];
      }
      return grouped.groups.flatMap(
        (g) => g.subGroups?.find((s) => s.groupKey === key)?.issues || [],
      );
    };

    const done = getIssuesByStatus("done");
    const inProgress = getIssuesByStatus("in_progress");
    const notStarted = getIssuesByStatus("not_started");

    const jiraBase = ((context.config.issueLinkBase as string) || "https://your-org.atlassian.net/browse").replace(/\/+$/, "");
    const toolLlm = getToolLlmConfig("generate_epic_narrative");
    const descLimit = resolveDescriptionLimit(context.config.narrative as Record<string, unknown> | undefined);

    const formatIssueData = (i: JiraIssue) => {
      const desc = i.description ? i.description.slice(0, descLimit) : "(no description)";
      return `- ${i.key} (${i.assignee || "Unassigned"}) [Status: ${i.status}]: ${i.summary}\n  ${desc}`;
    };

    const dataSections: string[] = [
      "Write epic narrative prose.",
      `JIRA_BASE: ${jiraBase}`,
      "",
    ];

    if (done.length > 0) {
      dataSections.push(`${NARRATIVE_MESSAGE_LABELS.done} (${done.length}):\n${done.map(formatIssueData).join("\n")}`);
    }
    if (inProgress.length > 0) {
      dataSections.push(`${NARRATIVE_MESSAGE_LABELS.inProgress} (${inProgress.length}):\n${inProgress.map(formatIssueData).join("\n")}`);
    }
    if (notStarted.length > 0) {
      dataSections.push(`${NARRATIVE_MESSAGE_LABELS.notStarted} (${notStarted.length}):\n${notStarted.map(formatIssueData).join("\n")}`);
    }

    const expected = { done: done.length, inProgress: inProgress.length, notStarted: notStarted.length };
    const allIssueKeys = [...done, ...inProgress, ...notStarted].map((i) => i.key);
    const userMessage = `${dataSections.join("\n\n")}\n\n${buildEpicMarkdownExample(expected)}`;

    const searchEntry = [...log].reverse().find((tc) => tc.tool === "search_jira_issues");
    const searchResult = searchEntry?.result as { issues?: JiraIssue[] } | undefined;
    const allIssues = searchResult?.issues || [];
    const epicIssue = allIssues.find((i) => i.issueType === "Epic");

    const bodyMarkdown = await callMarkdownNarrativeLlm({
      llm: context.llm,
      tracingTool: "generate_epic_narrative",
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      model: toolLlm.model,
      traceLabel: epicIssue?.key || "epic",
      maxTokens: toolLlm.maxTokens,
      temperature: toolLlm.temperature,
      requiredIssueKeys: allIssueKeys,
    });

    if (!bodyMarkdown.trim()) {
      return { narrative: "", summary: "Narrative generation failed — no markdown output." };
    }

    const buildEntry = [...log].reverse().find((tc) => tc.tool === "build_epic_jql");
    const buildResult = buildEntry?.result as { assigneeFiltered?: boolean } | undefined;
    const assigneeFiltered = buildResult?.assigneeFiltered;

    const resolveEntry = [...log].reverse().find((tc) => tc.tool === "resolve_assignees");
    const resolveResult = resolveEntry?.result as { resolved?: { name: string }[] } | undefined;
    const filteredAssignee = assigneeFiltered && resolveResult?.resolved?.[0]?.name;

    const header: EpicHeader | undefined = epicIssue
      ? { key: epicIssue.key, summary: epicIssue.summary, jiraBase, assignee: filteredAssignee || null }
      : undefined;

    let narrative = assembleEpicMarkdown(bodyMarkdown, header);

    const diff = log ? extractDiffFromLog(log) : null;
    if (diff) {
      const diffBlock = formatDiffBlock(diff, jiraBase);
      if (diffBlock) narrative = diffBlock + "\n\n" + narrative;
    }

    return {
      narrative,
      summary: `Narrative generated (${done.length} done, ${inProgress.length} in progress, ${notStarted.length} not started). Full content available via contentFrom: "generate_epic_narrative".`,
    };
  },
};
