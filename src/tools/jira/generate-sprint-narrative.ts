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
import { nestGroupIssues } from "./group-issues.js";
import { getToolLlmConfig } from "../../lib/models.js";
import { extractDiffFromLog, formatDiffBlock, epicGroupKeyFromParent, type ParentChange } from "./format-diff.js";
import {
  appendMarkdownInstructions,
  callMarkdownNarrativeLlm,
  extractStatusSection,
  legacyProseToMarkdown,
  type StatusCounts,
} from "../../lib/narrative-markdown.js";
import { NARRATIVE_HEADINGS, NARRATIVE_MESSAGE_LABELS } from "../../lib/narrative-headings.js";
import { resolveDescriptionLimit } from "../../lib/narrative-config.js";
import type { ToolLlmConfig } from "../../lib/resolve-model.js";
import {
  computeThread,
  collectGroupIssueKeys,
  loadNarrativeCache,
  saveNarrativeCache,
  resolveSectionMarkdown,
  type GroupSection,
} from "./narrative-cache.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, "../../prompts/sprint-narrative.md"), "utf-8").trim();

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

/** @deprecated Legacy structured narrative — use unit markdown strings. */
export interface GroupNarrative {
  groupKey: string;
  done?: string[];
  inProgress?: string[];
  notStarted?: string[];
}

/** Convert legacy test fixtures or old cache prose to a markdown map. */
export function toMarkdownMap(input: Map<string, string> | GroupNarrative[]): Map<string, string> {
  if (input instanceof Map) return input;
  return new Map(input.map((g) => [g.groupKey, legacyProseToMarkdown(g)]));
}

/** @deprecated Legacy structured cache entries — normalized on read. */
export function normalizeGroupNarrative(prose: GroupNarrative): string {
  return legacyProseToMarkdown(prose);
}

export function expectedSectionsFromGroup(group: IssueGroup): StatusCounts {
  return {
    done: getSubGroupIssues(group, "done").length,
    inProgress: getSubGroupIssues(group, "in_progress").length,
    notStarted: getSubGroupIssues(group, "not_started").length,
  };
}

export function expectedSectionsFromUnit(unit: EpicUnit): StatusCounts {
  return {
    done: unit.done.length,
    inProgress: unit.inProgress.length,
    notStarted: unit.notStarted.length,
  };
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
  unitMarkdown: Map<string, string> | GroupNarrative[],
  jiraBase: string,
): AssembleResult {
  const markdownByKey = toMarkdownMap(unitMarkdown);
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

  function renderGroup(dataGroup: IssueGroup, unitMd: string | undefined): string | null {
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

    if (unitMd?.trim()) {
      sections.push(unitMd.trim());
    } else {
      if (done.length > 0) {
        sections.push(`${NARRATIVE_HEADINGS.done}\n\n_No narrative generated._`);
      }
      if (inProgress.length > 0) {
        sections.push(`${NARRATIVE_HEADINGS.inProgress}\n\n_No narrative generated._`);
      }
      if (notStarted.length > 0) {
        sections.push(`${NARRATIVE_HEADINGS.notStarted}\n\n_No narrative generated._`);
      }
    }

    return sections.join("\n\n");
  }

  function resolveMarkdown(dataGroup: IssueGroup): string | undefined {
    const direct =
      markdownByKey.get(dataGroup.groupKey)
      ?? markdownByKey.get(dataGroup.groupLabel)
      ?? markdownByKey.get(dataGroup.groupKey.toLowerCase())
      ?? markdownByKey.get(dataGroup.groupLabel.toLowerCase());
    if (direct) return direct;

    for (const [key, md] of markdownByKey) {
      const resolved = resolveDataGroup(key);
      if (resolved?.groupKey === dataGroup.groupKey) return md;
    }
    return undefined;
  }

  const matchedKeys = new Set<string>();
  for (const [key] of markdownByKey) {
    if (resolveDataGroup(key)) matchedKeys.add(key);
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
    const section = renderGroup(dataGroup, resolveMarkdown(dataGroup));
    if (section) {
      md.push(section);
      nonEmptyCount++;
    }
  }

  const unmatchedKeys = [...markdownByKey.keys()].filter((key) => !resolveDataGroup(key));

  return {
    markdown: linkifyIssueKeys(md.join("\n\n---\n\n"), allKeys, jiraBase),
    matched: matchedKeys.size,
    total: nonEmptyCount,
    unmatchedKeys,
  };
}

function formatIssue(i: JiraIssue, outerKey: string, descLimit: number): string {
  const desc = i.description ? i.description.slice(0, descLimit) : "(no description)";
  let epic = "";
  if (i.parent?.issueType === "Epic") {
    epic = outerKey === "assignee"
      ? ` [Epic: ${i.parent.key} — ${i.parent.summary}]`
      : ` [Epic: ${i.parent.key}]`;
  }
  return `  - ${i.key} [${i.issueType}] (${i.assignee || "Unassigned"}) [Status: ${i.status}]${epic}: ${i.summary}\n    ${desc}`;
}

export function buildGroupMessage(
  group: IssueGroup,
  outerKey: string,
  jiraBase: string,
  descLimit: number,
): string {
  const fmt = (i: JiraIssue) => formatIssue(i, outerKey, descLimit);

  const sortByEpic = (issues: JiraIssue[]) => [...issues].sort((a, b) => {
    const aKey = a.parent?.issueType === "Epic" ? a.parent.key : "_none_";
    const bKey = b.parent?.issueType === "Epic" ? b.parent.key : "_none_";
    return aKey.localeCompare(bKey);
  });

  const groupNoun = outerKey === "epic" ? "epic" : "team member";
  const lines: string[] = [
    `Write prose for this single ${groupNoun}.`,
    `JIRA_BASE: ${jiraBase}`,
    "",
    `GROUP KEY: ${group.groupKey}`,
    `GROUP LABEL: ${group.groupLabel}`,
  ];

  if (group.subGroups) {
    const statusGroups = [
      { key: "done", label: NARRATIVE_MESSAGE_LABELS.done },
      { key: "in_progress", label: NARRATIVE_MESSAGE_LABELS.inProgress },
      { key: "not_started", label: NARRATIVE_MESSAGE_LABELS.notStarted },
    ];

    for (const { key, label } of statusGroups) {
      const statusSub = group.subGroups.find((s) => s.groupKey === key);
      if (!statusSub || statusSub.issues.length === 0) continue;
      const issues = outerKey === "assignee" ? sortByEpic(statusSub.issues) : statusSub.issues;
      lines.push(`  ${label} (${issues.length}):`);
      lines.push(...issues.map(fmt));
    }
  } else {
    const all = collectIssues(group);
    lines.push(...all.map(fmt));
  }

  return lines.join("\n");
}

export interface EpicUnit {
  assigneeKey: string;
  assigneeLabel: string;
  epicKey: string;
  epicLabel: string;
  done: JiraIssue[];
  inProgress: JiraIssue[];
  notStarted: JiraIssue[];
}

export function flattenToEpicUnits(grouped: GroupIssuesResult): EpicUnit[] {
  const units: EpicUnit[] = [];

  for (const assigneeGroup of grouped.groups) {
    if (!assigneeGroup.subGroups) continue;

    const epicMap = new Map<string, EpicUnit>();

    for (const statusSub of assigneeGroup.subGroups) {
      const epicSubs = statusSub.subGroups || [{ groupKey: "_no_epic_", groupLabel: "Other Work", issues: statusSub.issues }];

      for (const epicSub of epicSubs) {
        if (!epicMap.has(epicSub.groupKey)) {
          epicMap.set(epicSub.groupKey, {
            assigneeKey: assigneeGroup.groupKey,
            assigneeLabel: assigneeGroup.groupLabel,
            epicKey: epicSub.groupKey,
            epicLabel: epicSub.groupLabel,
            done: [],
            inProgress: [],
            notStarted: [],
          });
        }
        const unit = epicMap.get(epicSub.groupKey)!;
        if (statusSub.groupKey === "done") unit.done.push(...epicSub.issues);
        else if (statusSub.groupKey === "in_progress") unit.inProgress.push(...epicSub.issues);
        else if (statusSub.groupKey === "not_started") unit.notStarted.push(...epicSub.issues);
      }
    }

    units.push(...epicMap.values());
  }

  return units;
}

export function buildEpicUnitMessage(unit: EpicUnit, jiraBase: string, descLimit: number): string {
  const fmt = (i: JiraIssue) => formatIssue(i, "assignee", descLimit);

  const lines: string[] = [
    `Write prose for this team member's work on one epic.`,
    `JIRA_BASE: ${jiraBase}`,
    "",
    `ASSIGNEE: ${unit.assigneeLabel}`,
    `EPIC: ${unit.epicLabel}`,
  ];

  if (unit.done.length > 0) {
    lines.push(`  ${NARRATIVE_MESSAGE_LABELS.done} (${unit.done.length}):`);
    lines.push(...unit.done.map(fmt));
  }
  if (unit.inProgress.length > 0) {
    lines.push(`  ${NARRATIVE_MESSAGE_LABELS.inProgress} (${unit.inProgress.length}):`);
    lines.push(...unit.inProgress.map(fmt));
  }
  if (unit.notStarted.length > 0) {
    lines.push(`  ${NARRATIVE_MESSAGE_LABELS.notStarted} (${unit.notStarted.length}):`);
    lines.push(...unit.notStarted.map(fmt));
  }

  return lines.join("\n");
}

export function assembleThreeLevelMarkdown(
  grouped: GroupIssuesResult,
  units: EpicUnit[],
  markdownMap: Map<string, string>,
  jiraBase: string,
): AssembleResult {
  const assigneeOrder = [...grouped.groups].sort((a, b) => {
    const aSpecial = a.groupKey.startsWith("_");
    const bSpecial = b.groupKey.startsWith("_");
    if (aSpecial !== bSpecial) return aSpecial ? 1 : -1;
    return a.groupLabel.localeCompare(b.groupLabel);
  });

  const allKeys = new Set<string>();
  for (const u of units) {
    for (const i of [...u.done, ...u.inProgress, ...u.notStarted]) allKeys.add(i.key);
  }

  const unitsByAssignee = new Map<string, EpicUnit[]>();
  for (const u of units) {
    if (!unitsByAssignee.has(u.assigneeKey)) unitsByAssignee.set(u.assigneeKey, []);
    unitsByAssignee.get(u.assigneeKey)!.push(u);
  }

  const md: string[] = [];
  let matched = 0;
  let total = 0;
  const unmatchedKeys: string[] = [];

  for (const assigneeGroup of assigneeOrder) {
    const assigneeUnits = unitsByAssignee.get(assigneeGroup.groupKey);
    if (!assigneeUnits || assigneeUnits.length === 0) continue;

    total++;
    const sections: string[] = [`## ${assigneeGroup.groupLabel}`];

    const statusOrder = [
      { statusField: "done" as const, heading: NARRATIVE_HEADINGS.done },
      { statusField: "inProgress" as const, heading: NARRATIVE_HEADINGS.inProgress },
      { statusField: "notStarted" as const, heading: NARRATIVE_HEADINGS.notStarted },
    ];

    for (const { statusField, heading } of statusOrder) {
      const epicsWithIssues = assigneeUnits.filter((u) => u[statusField].length > 0);
      if (epicsWithIssues.length === 0) continue;

      const epicParts: string[] = [];
      for (const u of epicsWithIssues) {
        const key = `${u.assigneeKey}::${u.epicKey}`;
        const unitMd = markdownMap.get(key) || "";
        const text = extractStatusSection(unitMd, heading) || "_No narrative generated._";
        if (extractStatusSection(unitMd, heading)) matched++;
        const label = u.epicKey === "_no_epic_" ? "**Other Work**" : `**${u.epicLabel}**`;
        epicParts.push(`${label}\n\n${text}`);
      }

      sections.push(`${heading}\n\n${epicParts.join("\n\n")}`);
    }

    md.push(sections.join("\n\n"));
  }

  return {
    markdown: linkifyIssueKeys(md.join("\n\n---\n\n"), allKeys, jiraBase),
    matched,
    total,
    unmatchedKeys,
  };
}

async function callUnitNarrativeLlm(
  llm: ExecutionContext["llm"],
  userMessage: string,
  traceLabel: string,
  toolLlm: ToolLlmConfig,
  expected: StatusCounts,
  issues: JiraIssue[],
): Promise<string> {
  return callMarkdownNarrativeLlm({
    llm,
    tracingTool: "generate_sprint_narrative",
    systemPrompt: SYSTEM_PROMPT,
    userMessage: appendMarkdownInstructions(userMessage, expected, issues),
    model: toolLlm.model,
    traceLabel,
    maxTokens: toolLlm.maxTokens,
    temperature: toolLlm.temperature,
    requiredIssueKeys: issues.map((i) => i.key),
  });
}

async function generateForGroup(
  group: IssueGroup,
  outerKey: string,
  jiraBase: string,
  descLimit: number,
  llm: ExecutionContext["llm"],
  toolLlm: ToolLlmConfig,
): Promise<{ groupKey: string; markdown: string }> {
  const userMessage = buildGroupMessage(group, outerKey, jiraBase, descLimit);
  const issues = collectIssues(group);
  const markdown = await callUnitNarrativeLlm(
    llm,
    userMessage,
    group.groupKey,
    toolLlm,
    expectedSectionsFromGroup(group),
    issues,
  );
  return { groupKey: group.groupKey, markdown };
}

/**
 * Build diff signals from the snapshot diff for selective regeneration.
 */
export function buildDiffSignals(log: { tool: string; args: unknown; result: unknown }[]): {
  changedIssueKeys: Set<string>;
  parentChanges: ParentChange[];
} | null {
  const entry = [...log].reverse().find(
    (tc) => tc.tool === "jira_search_snapshots" && (tc.args as Record<string, unknown>).action === "diff",
  );
  if (!entry) return null;

  const result = entry.result as Record<string, unknown> | null;
  if (!result || result.baselineTimestamp == null) return null;

  const changedIssueKeys = new Set<string>();
  for (const k of (result.added as string[]) || []) changedIssueKeys.add(k);
  for (const k of (result.removed as string[]) || []) changedIssueKeys.add(k);
  for (const sc of (result.statusChanges as Array<{ key: string }>) || []) changedIssueKeys.add(sc.key);

  const parentChanges = (result.parentChanges as ParentChange[]) || [];
  for (const pc of parentChanges) changedIssueKeys.add(pc.key);

  return { changedIssueKeys, parentChanges };
}

/** @deprecated Use buildDiffSignals */
export function buildChangedKeySet(log: { tool: string; args: unknown; result: unknown }[]): Set<string> | null {
  const signals = buildDiffSignals(log);
  return signals ? signals.changedIssueKeys : null;
}

export function isGroupAffectedByDiff(
  groupKey: string,
  groupIssueKeys: string[],
  changedIssueKeys: Set<string>,
  parentChanges: ParentChange[],
): boolean {
  if (groupIssueKeys.some((k) => changedIssueKeys.has(k))) return true;
  for (const pc of parentChanges) {
    if (epicGroupKeyFromParent(pc.was) === groupKey || epicGroupKeyFromParent(pc.now) === groupKey) {
      return true;
    }
  }
  return false;
}

/**
 * When the orchestrator calls group_issues with assignee → status only, upgrade to
 * assignee → status → epic so narratives get per-epic sub-headings and smaller LLM calls.
 */
export function upgradeAssigneeGrouping(
  grouped: GroupIssuesResult,
  issues: JiraIssue[],
): GroupIssuesResult {
  const keys = grouped.groupBy;
  if (keys.length !== 2 || keys[0] !== "assignee" || keys[1] !== "status") {
    return grouped;
  }

  process.stderr.write(
    "  [narrative] Upgrading groupBy assignee → status to assignee → status → epic\n",
  );

  const { groups, dropped } = nestGroupIssues(issues, ["assignee", "status", "epic"]);
  return {
    groups,
    groupBy: ["assignee", "status", "epic"],
    total: grouped.total,
    dropped,
    summary: `Regrouped for narrative: ${groups.length} assignees (assignee → status → epic).`,
  };
}

/**
 * Extract the JQL string from the most recent search_jira_issues result in the log.
 */
function extractIssuesFromLog(log: { tool: string; result: unknown }[]): JiraIssue[] | null {
  const entry = [...log].reverse().find((tc) => tc.tool === "search_jira_issues");
  if (!entry) return null;
  const result = entry.result as { issues?: JiraIssue[] } | null;
  return result?.issues ?? null;
}

function extractJqlFromLog(log: { tool: string; result: unknown }[]): string | null {
  const entry = [...log].reverse().find((tc) => tc.tool === "search_jira_issues");
  if (!entry) return null;
  const result = entry.result as { jql?: string } | null;
  return result?.jql || null;
}

/**
 * If the orchestrator calls generate_sprint_narrative twice in one run, reuse the
 * first result instead of burning LLM calls again on the same diff.
 */
export function findPriorNarrativeInLog(
  log: { tool: string; args: unknown; result: unknown }[],
): { narrative: string; summary: string } | null {
  const lastGenIdx = log.findLastIndex((tc) => tc.tool === "generate_sprint_narrative");
  if (lastGenIdx < 0) return null;

  const after = log.slice(lastGenIdx + 1);
  const invalidated = after.some((tc) => {
    if (tc.tool === "group_issues") return true;
    if (tc.tool === "jira_narrative_cache") {
      return (tc.args as Record<string, unknown>).action === "remove_thread";
    }
    return false;
  });
  if (invalidated) return null;

  const result = log[lastGenIdx].result as { narrative?: string; summary?: string; error?: string } | null;
  if (result?.error) {
    throw new Error(`${result.error} (generate_sprint_narrative already failed this run — do not retry)`);
  }
  if (!result?.narrative) return null;

  return {
    narrative: result.narrative,
    summary: result.summary || "Sprint narrative generated.",
  };
}

/**
 * Split assembled markdown into per-group rendered sections.
 * Groups are separated by \n\n---\n\n in the assembled output.
 */
export function splitMarkdownSections(markdown: string): string[] {
  return markdown.split("\n\n---\n\n");
}

export const generateSprintNarrativeTool: Tool = {
  name: "generate_sprint_narrative",
  description:
    "Generate a prose sprint narrative from the last group_issues result. Expects group_issues called with ['epic', 'status'] or ['assignee', 'status', 'epic'] (use the 3-key form when user asks for assignee then epic). Uses parallel LLM calls (one per group, or one per assignee×epic). Automatically reuses cached prose for groups with no ticket changes. Call once per run — for Notion/Slack, use contentFrom instead of calling again. Returns markdown.",
  parameters: {
    type: "object",
    properties: {},
  },

  async execute(_args, context: ExecutionContext) {
    const log = context.toolCallLog;
    if (!log || log.length === 0) {
      throw new Error("No tool call log available — run group_issues first.");
    }

    const prior = findPriorNarrativeInLog(log);
    if (prior) {
      process.stderr.write("  [narrative] Already generated this run — reusing prior result\n");
      return {
        narrative: prior.narrative,
        summary: `${prior.summary} (reused — already generated this run). Use contentFrom for Notion/Slack.`,
      };
    }

    const groupEntry = [...log].reverse().find((tc) => tc.tool === "group_issues");
    if (!groupEntry) {
      throw new Error("No group_issues result found in tool call log. Run group_issues first.");
    }

    let grouped = groupEntry.result as GroupIssuesResult;
    if (!grouped.groups || grouped.groups.length === 0) {
      throw new Error("group_issues result has no groups.");
    }

    const searchIssues = extractIssuesFromLog(log);
    if (searchIssues) {
      grouped = upgradeAssigneeGrouping(grouped, searchIssues);
    }

    const jiraBase = ((context.config.issueLinkBase as string) || "https://your-org.atlassian.net/browse").replace(/\/+$/, "");
    const toolLlm = getToolLlmConfig("generate_sprint_narrative");
    const descLimit = resolveDescriptionLimit(context.config.narrative as Record<string, unknown> | undefined);
    const outerKey = grouped.groupBy[0];
    const hasThirdLevel = grouped.groupBy.length >= 3;

    // --- Narrative cache: load prior run ---
    const jql = extractJqlFromLog(log);
    const thread = jql ? computeThread(jql) : null;
    const diffSignals = buildDiffSignals(log);
    const cache = thread ? loadNarrativeCache(thread, grouped.groupBy) : null;
    const cachedByKey = cache ? new Map(cache.sections.map((s) => [s.groupKey, s])) : null;

    const canReuse = cache !== null && cachedByKey !== null && diffSignals !== null
      && (diffSignals.changedIssueKeys.size > 0 || diffSignals.parentChanges.length > 0);

    let narrative: string;
    let totalDelivered: number;
    let totalInProgress: number;
    let llmCallCount: number;
    let reusedCount = 0;

    if (hasThirdLevel && outerKey === "assignee") {
      // 3-level: one LLM call per (assignee × epic)
      const units = flattenToEpicUnits(grouped);
      const totalUnits = units.length;
      let unitsToGenerate: EpicUnit[];
      const markdownMap = new Map<string, string>();

      if (canReuse) {
        unitsToGenerate = [];
        for (const unit of units) {
          const compositeKey = `${unit.assigneeKey}::${unit.epicKey}`;
          const cached = cachedByKey!.get(compositeKey);
          const affected = isGroupAffectedByDiff(
            unit.epicKey,
            [...unit.done, ...unit.inProgress, ...unit.notStarted].map((i) => i.key),
            diffSignals!.changedIssueKeys,
            diffSignals!.parentChanges,
          );
          if (cached && !affected) {
            const md = resolveSectionMarkdown(cached);
            if (md) markdownMap.set(compositeKey, md);
            reusedCount++;
          } else {
            unitsToGenerate.push(unit);
          }
        }
      } else {
        unitsToGenerate = units;
      }

      llmCallCount = unitsToGenerate.length;
      if (reusedCount > 0) {
        process.stderr.write(`  [narrative] ${reusedCount}/${totalUnits} groups unchanged — reusing cache\n`);
      }

      if (llmCallCount > 0) {
        process.stderr.write(`  [narrative] Starting ${llmCallCount} LLM calls (assignee × epic)...\n`);
        const overallStart = Date.now();

        const results = await Promise.all(
          unitsToGenerate.map(async (unit) => {
            const userMessage = buildEpicUnitMessage(unit, jiraBase, descLimit);
            const compositeKey = `${unit.assigneeKey}::${unit.epicKey}`;
            const issues = [...unit.done, ...unit.inProgress, ...unit.notStarted];
            const markdown = await callUnitNarrativeLlm(
              context.llm,
              userMessage,
              `${unit.assigneeLabel} / ${unit.epicLabel}`,
              toolLlm,
              expectedSectionsFromUnit(unit),
              issues,
            );
            return { key: compositeKey, markdown };
          }),
        );

        const overallMs = Date.now() - overallStart;
        process.stderr.write(`  [narrative] All ${llmCallCount} calls complete — ${overallMs}ms total\n`);

        for (const r of results) markdownMap.set(r.key, r.markdown);
      }

      const assembled = assembleThreeLevelMarkdown(grouped, units, markdownMap, jiraBase);
      narrative = assembled.markdown;

      totalDelivered = units.reduce((n, u) => n + u.done.length, 0);
      totalInProgress = units.reduce((n, u) => n + u.inProgress.length, 0);

      // Save cache
      if (thread) {
        const sections: GroupSection[] = [];
        const freshSections = splitMarkdownSections(assembled.markdown);
        // For 3-level, cache is per composite key (assignee::epic)
        for (const unit of units) {
          const compositeKey = `${unit.assigneeKey}::${unit.epicKey}`;
          const issueKeys = [...unit.done, ...unit.inProgress, ...unit.notStarted].map((i) => i.key);
          sections.push({
            groupKey: compositeKey,
            groupLabel: `${unit.assigneeLabel} / ${unit.epicLabel}`,
            issueKeys,
            markdown: markdownMap.get(compositeKey) || "",
            renderedMarkdown: "",
          });
        }
        // Store the per-assignee rendered sections in cache
        const sortedGroups = [...grouped.groups].sort((a, b) => {
          const aSpecial = a.groupKey.startsWith("_");
          const bSpecial = b.groupKey.startsWith("_");
          if (aSpecial !== bSpecial) return aSpecial ? 1 : -1;
          return a.groupLabel.localeCompare(b.groupLabel);
        });
        for (let gi = 0; gi < sortedGroups.length && gi < freshSections.length; gi++) {
          const assigneeKey = sortedGroups[gi].groupKey;
          const assigneeSections = sections.filter((s) => s.groupKey.startsWith(assigneeKey + "::"));
          for (const s of assigneeSections) {
            s.renderedMarkdown = freshSections[gi];
          }
        }
        saveNarrativeCache({ thread, groupBy: grouped.groupBy, sections });
      }
    } else {
      // 2-level: one LLM call per outer group
      const totalGroups = grouped.groups.length;
      let groupsToGenerate: IssueGroup[];
      const cachedMarkdown = new Map<string, string>();

      if (canReuse) {
        groupsToGenerate = [];
        for (const group of grouped.groups) {
          const groupIssueKeys = collectGroupIssueKeys(group);
          const cached = cachedByKey!.get(group.groupKey);
          const affected = isGroupAffectedByDiff(
            group.groupKey,
            groupIssueKeys,
            diffSignals!.changedIssueKeys,
            diffSignals!.parentChanges,
          );
          if (cached && !affected) {
            const md = resolveSectionMarkdown(cached);
            if (md) cachedMarkdown.set(group.groupKey, md);
            reusedCount++;
          } else {
            groupsToGenerate.push(group);
          }
        }
      } else {
        groupsToGenerate = grouped.groups;
      }

      llmCallCount = groupsToGenerate.length;
      if (reusedCount > 0) {
        process.stderr.write(`  [narrative] ${reusedCount}/${totalGroups} groups unchanged — reusing cache\n`);
      }

      let freshResults: { groupKey: string; markdown: string }[];
      if (llmCallCount > 0) {
        process.stderr.write(`  [narrative] Starting ${llmCallCount} LLM calls...\n`);
        const overallStart = Date.now();

        freshResults = await Promise.all(
          groupsToGenerate.map((group) =>
            generateForGroup(group, outerKey, jiraBase, descLimit, context.llm, toolLlm),
          ),
        );

        const overallMs = Date.now() - overallStart;
        process.stderr.write(`  [narrative] All ${llmCallCount} calls complete — ${overallMs}ms total\n`);
      } else {
        freshResults = [];
      }

      const markdownByKey = new Map<string, string>(cachedMarkdown);
      for (const fresh of freshResults) {
        markdownByKey.set(fresh.groupKey, fresh.markdown);
      }

      const assembled = assembleMarkdown(grouped, markdownByKey, jiraBase);

      if (assembled.matched < assembled.total) {
        process.stderr.write(`  [warn] generate_sprint_narrative: ${assembled.matched}/${assembled.total} groups matched (unmatched LLM keys: ${assembled.unmatchedKeys.join(", ") || "none"})\n`);
      }

      narrative = assembled.markdown;
      totalDelivered = grouped.groups.reduce((n, g) => getSubGroupIssues(g, "done").length + n, 0);
      totalInProgress = grouped.groups.reduce((n, g) => getSubGroupIssues(g, "in_progress").length + n, 0);

      // Save cache
      if (thread) {
        const freshSections = splitMarkdownSections(assembled.markdown);
        const sorted = [...grouped.groups].sort((a, b) => {
          const aSpecial = a.groupKey.startsWith("_");
          const bSpecial = b.groupKey.startsWith("_");
          if (aSpecial !== bSpecial) return aSpecial ? 1 : -1;
          return a.groupLabel.localeCompare(b.groupLabel);
        });
        const sections: GroupSection[] = sorted.map((group, idx) => ({
          groupKey: group.groupKey,
          groupLabel: group.groupLabel,
          issueKeys: collectGroupIssueKeys(group),
          markdown: markdownByKey.get(group.groupKey) || "",
          renderedMarkdown: freshSections[idx] || "",
        }));
        saveNarrativeCache({ thread, groupBy: grouped.groupBy, sections });
      }
    }

    const diff = log ? extractDiffFromLog(log) : null;
    if (diff) {
      const diffBlock = formatDiffBlock(diff, jiraBase);
      if (diffBlock) narrative = diffBlock + "\n\n" + narrative;
    }

    const cacheNote = reusedCount > 0
      ? ` (${reusedCount} from cache)`
      : "";

    return {
      narrative,
      summary: `Sprint narrative generated — ${llmCallCount} LLM calls, ${reusedCount} reused from cache. ${totalDelivered} done, ${totalInProgress} in progress.${cacheNote} Full content available via contentFrom: "generate_sprint_narrative".`,
    };
  },
};
