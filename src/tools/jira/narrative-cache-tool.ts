/**
 * Tool: jira_narrative_cache
 * Manage narrative cache entries — list, count, remove, compact.
 */

import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import { cacheCount, cacheReadAll, cacheRemoveBefore } from "../../lib/cache.js";
import {
  computeThread,
  compactNarrativeCache,
  clearNarrativeCache,
  removeNarrativeCacheForThread,
  removeNarrativeCacheEntry,
  type NarrativeCacheEntry,
} from "./narrative-cache.js";

const CACHE_KEY = "narrative_cache";

function threadFromLog(log: { tool: string; result: unknown }[] | undefined): string | null {
  if (!log) return null;
  const entry = [...log].reverse().find((tc) => tc.tool === "search_jira_issues");
  if (!entry) return null;
  const jql = (entry.result as { jql?: string } | null)?.jql;
  return jql ? computeThread(jql) : null;
}

function groupByFromLog(log: { tool: string; result: unknown }[] | undefined): string[] | null {
  if (!log) return null;
  const entry = [...log].reverse().find((tc) => tc.tool === "group_issues");
  if (!entry) return null;
  const groupBy = (entry.result as { groupBy?: string[] } | null)?.groupBy;
  return groupBy?.length ? groupBy : null;
}

export const jiraNarrativeCacheTool: Tool = {
  name: "jira_narrative_cache",
  description:
    "Manage sprint narrative cache entries. Actions: 'count', 'list' (timestamps, threads, groupBy, section counts), 'remove_before' (delete entries older than a timestamp), 'remove_thread' (delete all entries for a JQL thread — omit thread to use the last search_jira_issues JQL), 'remove' (delete entries for thread + groupBy from the last search/group_issues), 'compact' (keep only the latest entry per thread + groupBy), 'clear' (delete all narrative cache entries). Timestamps are YYYY-MM-DDTHH:MM.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "One of: count, list, remove_before, remove_thread, remove, compact, clear",
      },
      before: {
        type: "string",
        description: "For remove_before: remove entries with timestamp < this value (YYYY-MM-DDTHH:MM)",
      },
      thread: {
        type: "string",
        description: "For remove_thread: JQL thread hash (32-char hex). Omit to derive from the last search_jira_issues result.",
      },
    },
    required: ["action"],
  },

  async execute(args, context: ExecutionContext) {
    const { action, before, thread: threadArg } = args as {
      action: string;
      before?: string;
      thread?: string;
    };

    switch (action) {
      case "count": {
        const count = cacheCount(CACHE_KEY);
        return { summary: `${count} narrative cache entr${count === 1 ? "y" : "ies"}.` };
      }

      case "list": {
        const snapshots = cacheReadAll<NarrativeCacheEntry>(CACHE_KEY);
        const entries = snapshots.map((s) => ({
          timestamp: s.timestamp,
          thread: s.data.thread.slice(0, 8),
          groupBy: s.data.groupBy.join(" → "),
          sectionCount: s.data.sections.length,
        }));
        const lines = entries.map(
          (e) => `${e.timestamp} | thread ${e.thread} | ${e.groupBy} | ${e.sectionCount} section(s)`,
        );
        return {
          entries,
          summary: entries.length > 0
            ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"}:\n${lines.join("\n")}`
            : "No narrative cache entries.",
        };
      }

      case "remove_before": {
        if (!before) {
          throw new Error("remove_before requires a 'before' timestamp (YYYY-MM-DDTHH:MM)");
        }
        const removed = cacheRemoveBefore<NarrativeCacheEntry>(CACHE_KEY, before);
        const remaining = cacheCount(CACHE_KEY);
        return { summary: `Removed ${removed} narrative cache entr${removed === 1 ? "y" : "ies"}. ${remaining} remaining.` };
      }

      case "remove_thread": {
        const thread = threadArg || threadFromLog(context.toolCallLog);
        if (!thread) {
          throw new Error("remove_thread requires a thread hash or a prior search_jira_issues result in the tool call log.");
        }
        const removed = removeNarrativeCacheForThread(thread);
        const remaining = cacheCount(CACHE_KEY);
        return {
          summary: `Removed ${removed} entr${removed === 1 ? "y" : "ies"} for thread ${thread.slice(0, 8)}. ${remaining} remaining.`,
        };
      }

      case "remove": {
        const thread = threadArg || threadFromLog(context.toolCallLog);
        const groupBy = groupByFromLog(context.toolCallLog);
        if (!thread) {
          throw new Error("remove requires a thread hash or a prior search_jira_issues result in the tool call log.");
        }
        if (!groupBy) {
          throw new Error("remove requires a prior group_issues result in the tool call log (or use remove_thread to drop all groupBy variants).");
        }
        const removed = removeNarrativeCacheEntry(thread, groupBy);
        const remaining = cacheCount(CACHE_KEY);
        return {
          summary: `Removed ${removed} entr${removed === 1 ? "y" : "ies"} for thread ${thread.slice(0, 8)} (${groupBy.join(" → ")}). ${remaining} remaining.`,
        };
      }

      case "compact": {
        const removed = compactNarrativeCache();
        const remaining = cacheCount(CACHE_KEY);
        return { summary: `Compacted narrative cache: removed ${removed} old entr${removed === 1 ? "y" : "ies"}. ${remaining} remaining.` };
      }

      case "clear": {
        const removed = clearNarrativeCache();
        return { summary: `Cleared narrative cache: removed ${removed} entr${removed === 1 ? "y" : "ies"}.` };
      }

      default:
        throw new Error(`Unknown action: ${action}. Use count, list, remove_before, remove_thread, remove, compact, or clear.`);
    }
  },
};
