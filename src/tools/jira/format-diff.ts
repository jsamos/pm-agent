/**
 * Shared utility: format a snapshot diff result into a markdown block
 * suitable for prepending to a narrative.
 */

import type { ToolCallEntry } from "../../lib/agent-loop.js";

export interface ParentChange {
  key: string;
  was: string | null;
  now: string | null;
}

export interface DiffData {
  changed: boolean;
  added: string[];
  removed: string[];
  statusChanges: Array<{ key: string; was: string; now: string }>;
  parentChanges: ParentChange[];
  baselineTimestamp: string | null;
}

/** Map a resolved epic parent key to the group_issues epic groupKey. */
export function epicGroupKeyFromParent(parentKey: string | null): string {
  return parentKey ?? "_no_epic_";
}

/**
 * Extract the most recent jira_search_snapshots diff result from the tool call log.
 * Returns null if no diff was run or if this is the first run (no baseline).
 */
export function extractDiffFromLog(log: ToolCallEntry[]): DiffData | null {
  const entry = [...log].reverse().find(
    (tc) => tc.tool === "jira_search_snapshots" && (tc.args as Record<string, unknown>).action === "diff",
  );
  if (!entry) return null;

  const result = entry.result as Record<string, unknown> | null;
  if (!result || result.baselineTimestamp == null) return null;

  return {
    changed: result.changed as boolean,
    added: (result.added as string[]) || [],
    removed: (result.removed as string[]) || [],
    statusChanges: (result.statusChanges as DiffData["statusChanges"]) || [],
    parentChanges: (result.parentChanges as ParentChange[]) || [],
    baselineTimestamp: result.baselineTimestamp as string,
  };
}

/**
 * Format a diff result as a markdown blockquote for the top of a narrative.
 * Returns an empty string if there's no meaningful diff to show.
 */
export function formatDiffBlock(diff: DiffData, jiraBase: string): string {
  if (!diff.baselineTimestamp) return "";

  const link = (key: string) => `[${key}](${jiraBase}/${key})`;

  if (!diff.changed) {
    return `> **No changes since ${diff.baselineTimestamp}.**`;
  }

  const parts: string[] = [];

  if (diff.added.length > 0) {
    parts.push(`${diff.added.length} added (${diff.added.map(link).join(", ")})`);
  }
  if (diff.removed.length > 0) {
    parts.push(`${diff.removed.length} removed (${diff.removed.map(link).join(", ")})`);
  }
  if (diff.statusChanges.length > 0) {
    const changes = diff.statusChanges
      .map((c) => `${link(c.key)}: ${c.was} → ${c.now}`)
      .join(", ");
    parts.push(`${diff.statusChanges.length} status change${diff.statusChanges.length > 1 ? "s" : ""} (${changes})`);
  }
  if (diff.parentChanges.length > 0) {
    const changes = diff.parentChanges
      .map((c) => {
        const was = c.was ? link(c.was) : "none";
        const now = c.now ? link(c.now) : "none";
        return `${link(c.key)}: ${was} → ${now}`;
      })
      .join(", ");
    parts.push(`${diff.parentChanges.length} parent change${diff.parentChanges.length > 1 ? "s" : ""} (${changes})`);
  }

  return `> **Changes since ${diff.baselineTimestamp}:** ${parts.join("; ")}`;
}
