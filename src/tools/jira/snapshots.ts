/**
 * Tool: jira_search_snapshots
 * Manages snapshots of Jira search results — save, diff, list, count, remove.
 * Timestamps use format: YYYY-MM-DDTHH:MM (e.g. 2026-08-14T09:33)
 */

import { createHash } from "node:crypto";
import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import { cacheAppend, cacheReadAll, cacheRemoveBefore, cacheCompact, cacheCount } from "../../lib/cache.js";

const CACHE_KEY = "jira_snapshots";

interface CachedIssue {
  key: string;
  statusCategory?: string;
  [k: string]: unknown;
}

interface SnapshotData {
  thread: string;
  jql: string;
  issues: CachedIssue[];
}

interface DiffResult {
  changed: boolean;
  added: string[];
  removed: string[];
  statusChanges: Array<{ key: string; was: string; now: string }>;
  baselineTimestamp: string | null;
  summary: string;
}

function diffIssues(fresh: CachedIssue[], baseline: CachedIssue[]): Omit<DiffResult, "baselineTimestamp" | "summary"> {
  const baselineMap = new Map(baseline.map((i) => [i.key, i]));
  const freshMap = new Map(fresh.map((i) => [i.key, i]));

  const added: string[] = [];
  const removed: string[] = [];
  const statusChanges: Array<{ key: string; was: string; now: string }> = [];

  for (const issue of fresh) {
    const prev = baselineMap.get(issue.key);
    if (!prev) {
      added.push(issue.key);
    } else if (prev.statusCategory !== issue.statusCategory) {
      statusChanges.push({
        key: issue.key,
        was: prev.statusCategory || "Unknown",
        now: issue.statusCategory || "Unknown",
      });
    }
  }

  for (const issue of baseline) {
    if (!freshMap.has(issue.key)) {
      removed.push(issue.key);
    }
  }

  const changed = added.length > 0 || removed.length > 0 || statusChanges.length > 0;
  return { changed, added, removed, statusChanges };
}

export const jiraSearchSnapshotsTool: Tool = {
  name: "jira_search_snapshots",
  description:
    "Manage Jira search result snapshots. Actions: 'save' (cache the last search_jira_issues result), 'diff' (compare fresh search against last cached snapshot — returns changed/unchanged), 'compact' (keep only the latest snapshot per query thread — removes old duplicates), 'count', 'list' (show timestamps and threads), 'remove_before' (delete entries older than a timestamp). Timestamps are YYYY-MM-DDTHH:MM.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "One of: save, diff, compact, count, list, remove_before",
      },
      before: {
        type: "string",
        description: "For remove_before: remove entries with timestamp < this value (YYYY-MM-DDTHH:MM)",
      },
    },
    required: ["action"],
  },

  async execute(args, context: ExecutionContext) {
    const { action, before } = args as { action: string; before?: string };

    switch (action) {
      case "save": {
        const log = context.toolCallLog;
        if (!log || log.length === 0) {
          throw new Error("No tool call log available — nothing to cache.");
        }

        const searchEntry = [...log].reverse().find((tc) => tc.tool === "search_jira_issues");
        if (!searchEntry) {
          throw new Error("No search_jira_issues result found in tool call log.");
        }

        const result = searchEntry.result as { issues?: unknown[]; jql?: string } | null;
        if (!result?.issues || !result?.jql) {
          throw new Error("search_jira_issues result missing issues or jql.");
        }

        const thread = createHash("md5").update(result.jql).digest("hex");
        cacheAppend(CACHE_KEY, { thread, jql: result.jql, issues: result.issues });

        return {
          summary: `Saved ${(result.issues as unknown[]).length} issues (thread ${thread.slice(0, 8)}).`,
        };
      }

      case "diff": {
        const diffLog = context.toolCallLog;
        if (!diffLog || diffLog.length === 0) {
          throw new Error("No tool call log available — run search_jira_issues first.");
        }

        const diffEntry = [...diffLog].reverse().find((tc) => tc.tool === "search_jira_issues");
        if (!diffEntry) {
          throw new Error("No search_jira_issues result found in tool call log.");
        }

        const freshResult = diffEntry.result as { issues?: CachedIssue[]; jql?: string } | null;
        if (!freshResult?.issues || !freshResult?.jql) {
          throw new Error("search_jira_issues result missing issues or jql.");
        }

        const diffThread = createHash("md5").update(freshResult.jql).digest("hex");

        // Find the most recent cached snapshot with the same thread
        const allSnapshots = cacheReadAll<SnapshotData>(CACHE_KEY);
        const baseline = [...allSnapshots].reverse().find(
          (s) => s.data.thread === diffThread
        );

        if (!baseline) {
          return {
            changed: true,
            added: freshResult.issues.map((i) => i.key),
            removed: [],
            statusChanges: [],
            baselineTimestamp: null,
            summary: "No baseline found for this query (first run).",
          } satisfies DiffResult;
        }

        const diff = diffIssues(freshResult.issues, baseline.data.issues);

        if (!diff.changed) {
          return {
            ...diff,
            baselineTimestamp: baseline.timestamp,
            summary: `No changes since ${baseline.timestamp}.`,
          } satisfies DiffResult;
        }

        const parts: string[] = [];
        if (diff.added.length > 0) parts.push(`${diff.added.length} added`);
        if (diff.removed.length > 0) parts.push(`${diff.removed.length} removed`);
        if (diff.statusChanges.length > 0) parts.push(`${diff.statusChanges.length} status changes`);

        return {
          ...diff,
          baselineTimestamp: baseline.timestamp,
          summary: `Changed since ${baseline.timestamp}: ${parts.join(", ")}.`,
        } satisfies DiffResult;
      }

      case "count": {
        const count = cacheCount(CACHE_KEY);
        return { summary: `${count} snapshot(s) cached.` };
      }

      case "list": {
        const snapshots = cacheReadAll(CACHE_KEY);
        const entries = snapshots.map((s) => {
          const data = s.data as { thread?: string; jql?: string; issues?: unknown[] };
          return {
            timestamp: s.timestamp,
            thread: data.thread?.slice(0, 8) ?? "unknown",
            issueCount: data.issues?.length ?? 0,
          };
        });
        const lines = entries.map(
          (e) => `${e.timestamp} | thread ${e.thread} | ${e.issueCount} issues`
        );
        return {
          entries,
          summary: entries.length > 0
            ? `${entries.length} snapshot(s):\n${lines.join("\n")}`
            : "No snapshots cached.",
        };
      }

      case "compact": {
        const removed = cacheCompact<SnapshotData>(CACHE_KEY, (d) => d.thread);
        const remaining = cacheCount(CACHE_KEY);
        return { summary: `Compacted: removed ${removed} old snapshot(s). ${remaining} thread(s) remaining.` };
      }

      case "remove_before": {
        if (!before) {
          throw new Error("remove_before requires a 'before' timestamp (YYYY-MM-DDTHH:MM)");
        }
        const removed = cacheRemoveBefore(CACHE_KEY, before);
        const remaining = cacheCount(CACHE_KEY);
        return { summary: `Removed ${removed} snapshot(s). ${remaining} remaining.` };
      }

      default:
        throw new Error(`Unknown action: ${action}. Use save, diff, compact, count, list, or remove_before.`);
    }
  },
};
