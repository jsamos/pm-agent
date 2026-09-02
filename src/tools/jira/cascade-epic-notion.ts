/**
 * Tool: cascade_epic_notion_updates
 * After a sprint diff with changes, regenerate assignee epic work pages in Notion.
 */

import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import type { ToolCallEntry } from "../../lib/agent-loop.js";
import type { DiffData } from "./format-diff.js";
import { getBaselineIssuesForJql } from "./snapshots.js";
import { buildEpicJqlTool } from "./build-epic-jql.js";
import { searchIssuesTool } from "./search-issues.js";
import { jiraSearchSnapshotsTool } from "./snapshots.js";
import { groupIssuesTool } from "./group-issues.js";
import { generateEpicNarrativeTool } from "./generate-epic-narrative.js";
import { updateNotionPageTool } from "../notion/update-page.js";
import { loadRosterFile } from "../roster/read.js";
import {
  deriveCascadePairs,
  validateRosterMembership,
  resolveWorkPageTargets,
  countOpenWork,
} from "../../lib/epic-cascade.js";
import type { JiraIssue } from "./search-issues.js";

export interface CascadeUpdatedPage {
  assigneeAccountId: string;
  assigneeDisplayName: string;
  pageUrl: string;
  epicKeys: string[];
}

export interface CascadeSkippedPage {
  assigneeAccountId: string;
  pageUrl: string;
  epicKeys: string[];
  reason: string;
}

export interface CascadeResult {
  updated: CascadeUpdatedPage[];
  skipped: CascadeSkippedPage[];
  notCreated: Array<{
    assigneeAccountId: string;
    assigneeDisplayName: string;
    epicKey: string;
    reason: "not created";
  }>;
  unassignedKeys: string[];
  summary: string;
}

function extractSprintDiffEntry(log: ToolCallEntry[]): DiffData {
  const entry = [...log].reverse().find(
    (tc) => tc.tool === "jira_search_snapshots" && (tc.args as Record<string, unknown>).action === "diff",
  );
  if (!entry) {
    throw new Error("No jira_search_snapshots diff found in tool call log. Run sprint diff first.");
  }

  const result = entry.result as Record<string, unknown> | null;
  if (!result) throw new Error("Sprint diff result missing.");

  return {
    changed: result.changed as boolean,
    added: (result.added as string[]) || [],
    removed: (result.removed as string[]) || [],
    statusChanges: (result.statusChanges as DiffData["statusChanges"]) || [],
    parentChanges: (result.parentChanges as DiffData["parentChanges"]) || [],
    assigneeChanges: (result.assigneeChanges as DiffData["assigneeChanges"]) || [],
    baselineTimestamp: (result.baselineTimestamp as string | null) ?? null,
  };
}

function getSprintSearchResult(log: ToolCallEntry[]): { issues: JiraIssue[]; jql: string } {
  const entry = [...log].reverse().find((tc) => tc.tool === "search_jira_issues");
  if (!entry) throw new Error("No search_jira_issues result found in tool call log.");
  const result = entry.result as { issues?: JiraIssue[]; jql?: string };
  if (!result.issues || !result.jql) {
    throw new Error("search_jira_issues result missing issues or jql.");
  }
  return { issues: result.issues, jql: result.jql };
}

export const cascadeEpicNotionUpdatesTool: Tool = {
  name: "cascade_epic_notion_updates",
  description:
    "Cascade epic Notion work page updates after a sprint narrative run. Call once after sprint diff + save and after generate_sprint_narrative (and optional sprint Notion update). Requires sprint search with resolveParentsTo: \"Epic\". Skips unmapped work pages (logs \"not created\"). Fails if a derived assignee is not on the roster.",
  parameters: {
    type: "object",
    properties: {},
  },

  async execute(_args, context: ExecutionContext): Promise<CascadeResult> {
    const log = context.toolCallLog;
    if (!log?.length) throw new Error("No tool call log available.");

    const diff = extractSprintDiffEntry(log);
    if (diff.baselineTimestamp && !diff.changed) {
      return {
        updated: [],
        skipped: [],
        notCreated: [],
        unassignedKeys: [],
        summary: "Sprint diff unchanged — no epic cascade.",
      };
    }

    const sprintSearch = getSprintSearchResult(log);
    const baselineIssues = diff.baselineTimestamp
      ? getBaselineIssuesForJql(sprintSearch.jql)
      : [];

    const { pairs, unassignedKeys } = deriveCascadePairs(diff, sprintSearch.issues, baselineIssues);

    if (pairs.length === 0) {
      return {
        updated: [],
        skipped: [],
        notCreated: [],
        unassignedKeys,
        summary: unassignedKeys.length
          ? `No cascade targets derived; ${unassignedKeys.length} unassigned ticket(s) logged.`
          : "No cascade targets derived from sprint diff.",
      };
    }

    const roster = loadRosterFile().resolved;
    validateRosterMembership(pairs, roster);

    const { targets, notCreated } = resolveWorkPageTargets(pairs, roster);
    const updated: CascadeUpdatedPage[] = [];
    const skipped: CascadeSkippedPage[] = [];

    for (const target of targets) {
      const buildResult = await buildEpicJqlTool.execute(
        { epicKeys: target.epicKeys, assignee: target.assigneeAccountId },
        context,
      ) as { jql: string; assigneeFiltered: boolean };

      const epicLog: ToolCallEntry[] = [
        {
          tool: "build_epic_jql",
          args: { epicKeys: target.epicKeys, assignee: target.assigneeAccountId },
          result: buildResult,
        },
        {
          tool: "resolve_assignees",
          args: {},
          result: { resolved: [{ name: target.assigneeDisplayName }] },
        },
      ];

      const searchResult = await searchIssuesTool.execute(
        {},
        { ...context, toolCallLog: epicLog },
      ) as { issues: JiraIssue[]; jql: string };

      epicLog.push({ tool: "search_jira_issues", args: {}, result: searchResult });

      if (countOpenWork(searchResult.issues) === 0) {
        skipped.push({
          assigneeAccountId: target.assigneeAccountId,
          pageUrl: target.pageUrl,
          epicKeys: target.epicKeys,
          reason: "no open work",
        });
        continue;
      }

      await jiraSearchSnapshotsTool.execute(
        { action: "save" },
        { ...context, toolCallLog: epicLog },
      );

      const groupResult = await groupIssuesTool.execute(
        { groupBy: "status" },
        { ...context, toolCallLog: epicLog },
      );
      epicLog.push({ tool: "group_issues", args: { groupBy: "status" }, result: groupResult });

      const narrativeResult = await generateEpicNarrativeTool.execute(
        {},
        { ...context, toolCallLog: epicLog },
      ) as { narrative: string };

      await updateNotionPageTool.execute(
        { pageUrl: target.pageUrl, content: narrativeResult.narrative },
        context,
      );

      updated.push({
        assigneeAccountId: target.assigneeAccountId,
        assigneeDisplayName: target.assigneeDisplayName,
        pageUrl: target.pageUrl,
        epicKeys: target.epicKeys,
      });
    }

    const parts: string[] = [];
    if (updated.length > 0) parts.push(`${updated.length} page(s) updated`);
    if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
    if (notCreated.length > 0) parts.push(`${notCreated.length} not created`);
    if (unassignedKeys.length > 0) parts.push(`${unassignedKeys.length} unassigned`);

    return {
      updated,
      skipped,
      notCreated,
      unassignedKeys,
      summary: parts.length > 0 ? `${parts.join("; ")}.` : "No work pages updated.",
    };
  },
};
