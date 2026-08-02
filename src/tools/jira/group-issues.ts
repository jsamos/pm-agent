/**
 * Tool: group_issues
 * Deterministic grouping of issues from the last search_jira_issues result.
 * Supports nested grouping via an ordered array of keys.
 *
 * Supported groupBy keys:
 * - "epic"     → parent epic key + summary (or "Other Work" if no epic parent)
 * - "assignee" → assignee display name (or "Unassigned")
 * - "status"   → statusCategory mapped to Done / In Progress / Not Started
 *
 * Single key returns flat groups. Multiple keys nest: first key is the
 * outer group, second key sub-groups within each, etc.
 */

import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import type { JiraIssue } from "./search-issues.js";

type GroupByKey = "epic" | "assignee" | "status";

export interface IssueGroup {
  groupKey: string;
  groupLabel: string;
  issues: JiraIssue[];
  subGroups?: IssueGroup[];
}

export interface GroupIssuesResult {
  groups: IssueGroup[];
  groupBy: GroupByKey[];
  total: number;
  dropped: number;
  summary: string;
}

const STATUS_MAP: Record<string, { groupKey: string; groupLabel: string }> = {
  "Done": { groupKey: "done", groupLabel: "Done" },
  "In Progress": { groupKey: "in_progress", groupLabel: "In Progress" },
  "To Do": { groupKey: "not_started", groupLabel: "Not Started" },
};

function resolveGroupKey(issue: JiraIssue, key: GroupByKey): { groupKey: string; groupLabel: string } | null {
  switch (key) {
    case "epic": {
      if (issue.parent?.issueType === "Epic") {
        return { groupKey: issue.parent.key, groupLabel: issue.parent.summary };
      }
      return { groupKey: "_no_epic_", groupLabel: "Other Work" };
    }
    case "assignee": {
      return {
        groupKey: issue.assignee || "_unassigned_",
        groupLabel: issue.assignee || "Unassigned",
      };
    }
    case "status": {
      const mapped = STATUS_MAP[issue.statusCategory];
      if (!mapped) return null;
      return mapped;
    }
    default:
      return null;
  }
}

function groupIssues(issues: JiraIssue[], keys: GroupByKey[], depth: number = 0): { groups: IssueGroup[]; dropped: number } {
  const currentKey = keys[depth];
  const remainingKeys = depth + 1 < keys.length;
  const map = new Map<string, IssueGroup>();
  let dropped = 0;

  for (const issue of issues) {
    if (issue.issueType === "Epic") {
      dropped++;
      continue;
    }

    const resolved = resolveGroupKey(issue, currentKey);
    if (!resolved) {
      dropped++;
      continue;
    }

    if (!map.has(resolved.groupKey)) {
      map.set(resolved.groupKey, {
        groupKey: resolved.groupKey,
        groupLabel: resolved.groupLabel,
        issues: [],
      });
    }

    map.get(resolved.groupKey)!.issues.push(issue);
  }

  const groups = Array.from(map.values());

  if (remainingKeys) {
    for (const group of groups) {
      const sub = groupIssues(group.issues, keys, depth + 1);
      group.subGroups = sub.groups;
      dropped += sub.dropped;
    }
  }

  // Sort: special keys (_no_epic_, _unassigned_) last, then by issue count desc
  groups.sort((a, b) => {
    const aSpecial = a.groupKey.startsWith("_");
    const bSpecial = b.groupKey.startsWith("_");
    if (aSpecial !== bSpecial) return aSpecial ? 1 : -1;
    return b.issues.length - a.issues.length;
  });

  return { groups, dropped };
}

export const groupIssuesTool: Tool = {
  name: "group_issues",
  description:
    "Group the last search_jira_issues result by one or more keys. Supports: 'epic', 'assignee', 'status'. Multiple keys nest (first key is outer group). Deterministic — no LLM call.",
  parameters: {
    type: "object",
    properties: {
      groupBy: {
        oneOf: [
          { type: "string", enum: ["epic", "assignee", "status"] },
          { type: "array", items: { type: "string", enum: ["epic", "assignee", "status"] } },
        ],
        description: "Key(s) to group by. A single string or an array for nested grouping (e.g. ['epic', 'status']).",
      },
    },
    required: ["groupBy"],
  },

  async execute(args, context: ExecutionContext): Promise<GroupIssuesResult> {
    const raw = (args as { groupBy: GroupByKey | GroupByKey[] }).groupBy;
    const keys: GroupByKey[] = Array.isArray(raw) ? raw : [raw];

    if (keys.length === 0) {
      throw new Error("groupBy must have at least one key.");
    }

    const log = context.toolCallLog;
    if (!log || log.length === 0) {
      throw new Error("No tool call log available — run search_jira_issues first.");
    }

    const searchEntry = [...log].reverse().find((tc) => tc.tool === "search_jira_issues");
    if (!searchEntry) {
      throw new Error("No search_jira_issues result found in tool call log.");
    }

    const result = searchEntry.result as { issues?: JiraIssue[] } | null;
    if (!result?.issues) {
      throw new Error("search_jira_issues result missing issues.");
    }

    const { groups, dropped } = groupIssues(result.issues, keys);

    const totalIssues = result.issues.length - dropped;
    const parts = groups.map((g) => {
      const sub = g.subGroups
        ? ` (${g.subGroups.map((s) => `${s.issues.length} ${s.groupLabel.toLowerCase()}`).join(", ")})`
        : "";
      return `${g.groupLabel}: ${g.issues.length}${sub}`;
    });

    return {
      groups,
      groupBy: keys,
      total: totalIssues,
      dropped,
      summary: `Grouped ${totalIssues} issues by ${keys.join(" → ")}: ${parts.join("; ")}.`,
    };
  },
};
