/**
 * Tool: generate_sprint_narrative
 * Reads the last group_issues result and generates a prose sprint narrative
 * using a dedicated LLM call. Expects group_issues to have been called with
 * groupBy: ["epic", "status"] or ["assignee", "status"].
 *
 * Headings are rendered deterministically from group data. The LLM only
 * writes prose content for each section.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import type { JiraIssue } from "./search-issues.js";
import type { IssueGroup, GroupIssuesResult } from "./group-issues.js";
import { getToolModel } from "../../lib/models.js";
import { extractDiffFromLog, formatDiffBlock } from "./format-diff.js";
import { trace } from "../../lib/agent-loop.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, "../../prompts/sprint-narrative.md"), "utf-8").trim();

const DEFAULT_DESC_LIMIT = 1000;

export function extractJson(raw: string): string {
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

function collectIssues(group: IssueGroup): JiraIssue[] {
  if (group.subGroups) {
    return group.subGroups.flatMap((sg) => sg.issues);
  }
  return group.issues;
}

export function getSubGroupIssues(group: IssueGroup, statusKey: string): JiraIssue[] {
  if (!group.subGroups) return [];
  const sg = group.subGroups.find((s) => s.groupKey === statusKey);
  return sg?.issues || [];
}

export function renderHeading(group: IssueGroup, outerKey: string, jiraBase: string): string {
  if (outerKey === "epic") {
    if (group.groupKey === "_no_epic_") return `## Standalone Items`;
    return `## ${group.groupLabel} ([${group.groupKey}](${jiraBase}/${group.groupKey}))`;
  }
  return `## ${group.groupLabel}`;
}

export interface GroupNarrative {
  groupKey: string;
  delivered?: string[];
  inProgress?: string[];
  notStarted?: string[];
}

export function linkifyIssueKeys(text: string, issueKeys: Set<string>, jiraBase: string): string {
  const sortedKeys = [...issueKeys].sort((a, b) => b.length - a.length);
  let result = text;
  for (const key of sortedKeys) {
    const linked = `[${key}](${jiraBase}/${key})`;
    const escaped = key.replace("-", "\\-");
    // Match bare keys: not preceded by [ or / and not followed by ] or (
    const barePattern = new RegExp(`(?<![\\[/])${escaped}(?![\\]\\(])`, "g");
    result = result.replace(barePattern, linked);
  }
  return result;
}

export interface AssembleResult {
  markdown: string;
  matched: number;
  total: number;
  unmatchedKeys: string[];
}

export function assembleMarkdown(
  grouped: GroupIssuesResult,
  parsedGroups: GroupNarrative[],
  jiraBase: string,
): AssembleResult {
  const outerKey = grouped.groupBy[0];
  const hasStatusSub = grouped.groupBy.length > 1 && grouped.groupBy[1] === "status";

  const dataByKey = new Map(grouped.groups.map((g) => [g.groupKey, g]));
  const dataByNormKey = new Map(grouped.groups.map((g) => [g.groupKey.toLowerCase().trim(), g]));
  const dataByLabel = new Map(grouped.groups.map((g) => [g.groupLabel.toLowerCase().trim(), g]));

  function resolveDataGroup(parsedKey: string): IssueGroup | undefined {
    const trimmed = parsedKey.trim();
    const normed = trimmed.toLowerCase();
    const match = dataByKey.get(parsedKey)
      ?? dataByKey.get(trimmed)
      ?? dataByNormKey.get(normed)
      ?? dataByLabel.get(normed);
    if (match) return match;

    // Handle composite keys the LLM may produce ("KEY — Label")
    const dashIdx = trimmed.indexOf(" — ");
    if (dashIdx !== -1) {
      const prefix = trimmed.slice(0, dashIdx).trim();
      const suffix = trimmed.slice(dashIdx + 3).trim();
      return dataByKey.get(prefix)
        ?? dataByNormKey.get(prefix.toLowerCase())
        ?? dataByLabel.get(suffix.toLowerCase());
    }
    return undefined;
  }

  function renderGroup(dataGroup: IssueGroup, prose: GroupNarrative | undefined): string | null {
    const done = hasStatusSub ? getSubGroupIssues(dataGroup, "done") : [];
    const inProgress = hasStatusSub ? getSubGroupIssues(dataGroup, "in_progress") : [];
    const notStarted = hasStatusSub ? getSubGroupIssues(dataGroup, "not_started") : [];

    if (done.length === 0 && inProgress.length === 0 && notStarted.length === 0) return null;

    const allIssues = [...done, ...inProgress, ...notStarted];
    const assignees = [...new Set(allIssues.map((i) => i.assignee).filter(Boolean))] as string[];
    assignees.sort((a, b) => a.localeCompare(b));

    const sections: string[] = [renderHeading(dataGroup, outerKey, jiraBase)];
    if (outerKey !== "assignee" && assignees.length > 0) {
      sections.push(`**${assignees.join(", ")}**`);
    }

    if (done.length > 0) {
      sections.push(prose?.delivered?.join("\n\n") || "_No narrative generated._");
    }
    if (inProgress.length > 0) {
      sections.push(`### In Progress\n\n${prose?.inProgress?.join("\n\n") || "_No narrative generated._"}`);
    }
    if (notStarted.length > 0) {
      sections.push(`### Not Started\n\n${prose?.notStarted?.join("\n\n") || "_No narrative generated._"}`);
    }

    return sections.join("\n\n");
  }

  const proseByKey = new Map<string, GroupNarrative>();
  for (const pg of parsedGroups) {
    const dataGroup = resolveDataGroup(pg.groupKey);
    if (dataGroup) proseByKey.set(dataGroup.groupKey, pg);
  }

  const sorted = [...grouped.groups].sort((a, b) => {
    const aSpecial = a.groupKey.startsWith("_");
    const bSpecial = b.groupKey.startsWith("_");
    if (aSpecial !== bSpecial) return aSpecial ? 1 : -1;
    return a.groupLabel.localeCompare(b.groupLabel);
  });

  const allKeys = new Set<string>();
  for (const g of grouped.groups) {
    const issues = g.subGroups ? g.subGroups.flatMap((sg) => sg.issues) : g.issues;
    for (const i of issues) allKeys.add(i.key);
  }

  const md: string[] = [];
  let nonEmptyCount = 0;
  for (const dataGroup of sorted) {
    const section = renderGroup(dataGroup, proseByKey.get(dataGroup.groupKey));
    if (section) {
      md.push(section);
      nonEmptyCount++;
    }
  }

  const unmatchedKeys = parsedGroups
    .filter((pg) => !resolveDataGroup(pg.groupKey))
    .map((pg) => pg.groupKey);

  return {
    markdown: linkifyIssueKeys(md.join("\n\n---\n\n"), allKeys, jiraBase),
    matched: proseByKey.size,
    total: nonEmptyCount,
    unmatchedKeys,
  };
}

export const generateSprintNarrativeTool: Tool = {
  name: "generate_sprint_narrative",
  description:
    "Generate a prose sprint narrative from the last group_issues result. Expects group_issues called with ['epic', 'status'] or ['assignee', 'status']. Uses a dedicated LLM call. Returns markdown.",
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

    const outerKey = grouped.groupBy[0];
    const hasStatusSub = grouped.groupBy.length > 1 && grouped.groupBy[1] === "status";

    const jiraBase = ((context.config.issueLinkBase as string) || "https://your-org.atlassian.net/browse").replace(/\/+$/, "");
    const narrativeCfg = (context.config.narrative as Record<string, unknown>) || {};
    const descLimit = (narrativeCfg.descriptionLimit as number) || DEFAULT_DESC_LIMIT;

    const formatIssue = (i: JiraIssue) => {
      const desc = i.description ? i.description.slice(0, descLimit) : "(no description)";
      let epic = "";
      if (i.parent?.issueType === "Epic") {
        epic = outerKey === "assignee"
          ? ` [Epic: ${i.parent.key} — ${i.parent.summary}]`
          : ` [Epic: ${i.parent.key}]`;
      }
      return `  - ${i.key} [${i.issueType}] (${i.assignee || "Unassigned"})${epic}: ${i.summary}\n    ${desc}`;
    };

    const sortByEpic = (issues: JiraIssue[]) => [...issues].sort((a, b) => {
      const aKey = a.parent?.issueType === "Epic" ? a.parent.key : "_none_";
      const bKey = b.parent?.issueType === "Epic" ? b.parent.key : "_none_";
      return aKey.localeCompare(bKey);
    });

    const groupNoun = outerKey === "epic" ? "epic" : "team member";
    const dataSections: string[] = [
      `Issues are grouped by ${groupNoun}.`,
      `JIRA_BASE: ${jiraBase}`,
    ];

    for (const group of grouped.groups) {
      const lines: string[] = [];
      lines.push(`GROUP KEY: ${group.groupKey}`);
      lines.push(`GROUP LABEL: ${group.groupLabel}`);

      if (hasStatusSub) {
        const done = getSubGroupIssues(group, "done");
        const inProgress = getSubGroupIssues(group, "in_progress");
        const notStarted = getSubGroupIssues(group, "not_started");

        const sortedDone = outerKey === "assignee" ? sortByEpic(done) : done;
        const sortedInProgress = outerKey === "assignee" ? sortByEpic(inProgress) : inProgress;
        const sortedNotStarted = outerKey === "assignee" ? sortByEpic(notStarted) : notStarted;

        if (sortedDone.length > 0) {
          lines.push(`  Done (${sortedDone.length}):`);
          lines.push(...sortedDone.map(formatIssue));
        }
        if (sortedInProgress.length > 0) {
          lines.push(`  In Progress (${sortedInProgress.length}):`);
          lines.push(...sortedInProgress.map(formatIssue));
        }
        if (sortedNotStarted.length > 0) {
          lines.push(`  Not Started (${sortedNotStarted.length}):`);
          lines.push(...sortedNotStarted.map(formatIssue));
        }
      } else {
        const all = collectIssues(group);
        lines.push(...all.map(formatIssue));
      }

      dataSections.push(lines.join("\n"));
    }

    const userMessage = dataSections.join("\n\n");

    trace("inner_llm_request", {
      tool: "generate_sprint_narrative",
      userMessage: userMessage.slice(0, 2000),
    });

    const llmStart = Date.now();
    const response = await context.llm.generate([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ], { model: getToolModel("generate_sprint_narrative"), temperature: 0.3 });
    const llmMs = Date.now() - llmStart;

    const raw = response.content || "";
    trace("inner_llm_call", {
      tool: "generate_sprint_narrative",
      ms: llmMs,
      response: raw.slice(0, 2000),
    });

    const jsonStr = extractJson(raw);

    let parsed: { groups?: GroupNarrative[] };
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      process.stderr.write(`  [warn] generate_sprint_narrative: JSON parse failed — ${(e as Error).message}\n`);
      trace("inner_llm_parse_error", { tool: "generate_sprint_narrative", error: (e as Error).message, raw: raw.slice(0, 1000) });
      return { narrative: raw };
    }

    const parsedGroupCount = parsed.groups?.length ?? 0;
    if (parsedGroupCount === 0) {
      process.stderr.write(`  [warn] generate_sprint_narrative: LLM returned 0 groups (keys in response: ${Object.keys(parsed).join(", ")})\n`);
      trace("inner_llm_empty_groups", { tool: "generate_sprint_narrative", responseKeys: Object.keys(parsed) });
    }

    const assembled = assembleMarkdown(grouped, parsed.groups ?? [], jiraBase);

    if (assembled.matched < assembled.total) {
      process.stderr.write(`  [warn] generate_sprint_narrative: ${assembled.matched}/${assembled.total} groups matched (unmatched LLM keys: ${assembled.unmatchedKeys.join(", ") || "none"})\n`);
    }

    let narrative = assembled.markdown;

    const diff = log ? extractDiffFromLog(log) : null;
    if (diff) {
      const diffBlock = formatDiffBlock(diff, jiraBase);
      if (diffBlock) narrative = diffBlock + "\n\n" + narrative;
    }

    const totalDelivered = grouped.groups.reduce((n, g) => getSubGroupIssues(g, "done").length + n, 0);
    const totalInProgress = grouped.groups.reduce((n, g) => getSubGroupIssues(g, "in_progress").length + n, 0);

    return {
      narrative,
      summary: `Sprint narrative generated (${grouped.groups.length} groups, ${totalDelivered} delivered, ${totalInProgress} in progress).`,
    };
  },
};
