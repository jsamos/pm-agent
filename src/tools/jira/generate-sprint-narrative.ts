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
import { extractDiffFromLog, formatDiffBlock, epicGroupKeyFromParent, type ParentChange } from "./format-diff.js";
import { trace } from "../../lib/agent-loop.js";
import {
  computeThread,
  collectGroupIssueKeys,
  loadNarrativeCache,
  saveNarrativeCache,
  type GroupSection,
  type NarrativeCacheEntry,
} from "./narrative-cache.js";

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
      { key: "done", label: "Done" },
      { key: "in_progress", label: "In Progress" },
      { key: "not_started", label: "Not Started" },
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
    lines.push(`  Done (${unit.done.length}):`);
    lines.push(...unit.done.map(fmt));
  }
  if (unit.inProgress.length > 0) {
    lines.push(`  In Progress (${unit.inProgress.length}):`);
    lines.push(...unit.inProgress.map(fmt));
  }
  if (unit.notStarted.length > 0) {
    lines.push(`  Not Started (${unit.notStarted.length}):`);
    lines.push(...unit.notStarted.map(fmt));
  }

  return lines.join("\n");
}

export function assembleThreeLevelMarkdown(
  grouped: GroupIssuesResult,
  units: EpicUnit[],
  proseMap: Map<string, GroupNarrative>,
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
      { statusField: "done" as const, proseField: "delivered" as const, heading: null },
      { statusField: "inProgress" as const, proseField: "inProgress" as const, heading: "### In Progress" },
      { statusField: "notStarted" as const, proseField: "notStarted" as const, heading: "### Not Started" },
    ];

    for (const { statusField, proseField, heading } of statusOrder) {
      const epicsWithIssues = assigneeUnits.filter((u) => u[statusField].length > 0);
      if (epicsWithIssues.length === 0) continue;

      const epicParts: string[] = [];
      for (const u of epicsWithIssues) {
        const key = `${u.assigneeKey}::${u.epicKey}`;
        const prose = proseMap.get(key);
        const text = prose?.[proseField]?.join("\n\n") || "_No narrative generated._";
        if (prose?.[proseField]) matched++;
        const label = u.epicKey === "_no_epic_" ? "**Other Work**" : `**${u.epicLabel}**`;
        epicParts.push(`${label}\n\n${text}`);
      }

      if (heading) {
        sections.push(`${heading}\n\n${epicParts.join("\n\n")}`);
      } else {
        sections.push(epicParts.join("\n\n"));
      }
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

async function generateForGroup(
  group: IssueGroup,
  outerKey: string,
  jiraBase: string,
  descLimit: number,
  llm: ExecutionContext["llm"],
): Promise<GroupNarrative> {
  const userMessage = buildGroupMessage(group, outerKey, jiraBase, descLimit);

  trace("inner_llm_request", {
    tool: "generate_sprint_narrative",
    groupKey: group.groupKey,
    userMessage: userMessage.slice(0, 2000),
  });

  const llmStart = Date.now();
  const response = await llm.generate([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ], { model: getToolModel("generate_sprint_narrative"), temperature: 0.3 });
  const llmMs = Date.now() - llmStart;

  const raw = response.content || "";
  trace("inner_llm_call", {
    tool: "generate_sprint_narrative",
    groupKey: group.groupKey,
    ms: llmMs,
    response: raw.slice(0, 2000),
  });

  process.stderr.write(`  [narrative] ${group.groupKey} — ${llmMs}ms\n`);

  const jsonStr = extractJson(raw);

  try {
    const parsed = JSON.parse(jsonStr) as GroupNarrative;
    if (!parsed.groupKey) parsed.groupKey = group.groupKey;
    return parsed;
  } catch (e) {
    process.stderr.write(`  [warn] generate_sprint_narrative: JSON parse failed for "${group.groupKey}" — ${(e as Error).message}\n`);
    trace("inner_llm_parse_error", {
      tool: "generate_sprint_narrative",
      groupKey: group.groupKey,
      error: (e as Error).message,
      raw: raw.slice(0, 1000),
    });
    return { groupKey: group.groupKey };
  }
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
 * Extract the JQL string from the most recent search_jira_issues result in the log.
 */
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
    "Generate a prose sprint narrative from the last group_issues result. Expects group_issues called with ['epic', 'status'] or ['assignee', 'status']. Uses parallel LLM calls (one per group). Automatically reuses cached prose for groups with no ticket changes. Call once per run — for Notion/Slack, use contentFrom instead of calling again. Returns markdown.",
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

    const grouped = groupEntry.result as GroupIssuesResult;
    if (!grouped.groups || grouped.groups.length === 0) {
      throw new Error("group_issues result has no groups.");
    }

    const jiraBase = ((context.config.issueLinkBase as string) || "https://your-org.atlassian.net/browse").replace(/\/+$/, "");
    const narrativeCfg = (context.config.narrative as Record<string, unknown>) || {};
    const descLimit = (narrativeCfg.descriptionLimit as number) || DEFAULT_DESC_LIMIT;
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
      const proseMap = new Map<string, GroupNarrative>();

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
            proseMap.set(compositeKey, cached.prose);
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

            trace("inner_llm_request", {
              tool: "generate_sprint_narrative",
              groupKey: compositeKey,
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
              groupKey: compositeKey,
              ms: llmMs,
              response: raw.slice(0, 2000),
            });

            process.stderr.write(`  [narrative] ${unit.assigneeLabel} / ${unit.epicLabel} — ${llmMs}ms\n`);

            try {
              const parsed = JSON.parse(extractJson(raw)) as GroupNarrative;
              return { key: compositeKey, narrative: parsed };
            } catch (e) {
              process.stderr.write(`  [warn] JSON parse failed for "${compositeKey}" — ${(e as Error).message}\n`);
              return { key: compositeKey, narrative: { groupKey: compositeKey } as GroupNarrative };
            }
          }),
        );

        const overallMs = Date.now() - overallStart;
        process.stderr.write(`  [narrative] All ${llmCallCount} calls complete — ${overallMs}ms total\n`);

        for (const r of results) proseMap.set(r.key, r.narrative);
      }

      const assembled = assembleThreeLevelMarkdown(grouped, units, proseMap, jiraBase);
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
            prose: proseMap.get(compositeKey) || { groupKey: compositeKey },
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
      const cachedProse = new Map<string, GroupNarrative>();

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
            cachedProse.set(group.groupKey, cached.prose);
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

      let parsedGroups: GroupNarrative[];
      if (llmCallCount > 0) {
        process.stderr.write(`  [narrative] Starting ${llmCallCount} LLM calls...\n`);
        const overallStart = Date.now();

        parsedGroups = await Promise.all(
          groupsToGenerate.map((group) =>
            generateForGroup(group, outerKey, jiraBase, descLimit, context.llm),
          ),
        );

        const overallMs = Date.now() - overallStart;
        process.stderr.write(`  [narrative] All ${llmCallCount} calls complete — ${overallMs}ms total\n`);
      } else {
        parsedGroups = [];
      }

      // Merge fresh LLM results with cached prose
      const allProse: GroupNarrative[] = [];
      for (const group of grouped.groups) {
        const fresh = parsedGroups.find((pg) => {
          const trimmed = pg.groupKey.trim().toLowerCase();
          return trimmed === group.groupKey.toLowerCase() || trimmed === group.groupLabel.toLowerCase();
        });
        if (fresh) {
          allProse.push(fresh);
        } else if (cachedProse.has(group.groupKey)) {
          allProse.push(cachedProse.get(group.groupKey)!);
        }
      }

      const assembled = assembleMarkdown(grouped, allProse, jiraBase);

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
          prose: allProse.find((p) => p.groupKey === group.groupKey || p.groupKey.toLowerCase() === group.groupKey.toLowerCase()) || { groupKey: group.groupKey },
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
      summary: `Sprint narrative generated — ${llmCallCount} LLM calls, ${reusedCount} reused from cache. ${totalDelivered} delivered, ${totalInProgress} in progress.${cacheNote} Full content available via contentFrom: "generate_sprint_narrative".`,
    };
  },
};
