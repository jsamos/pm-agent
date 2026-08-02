/**
 * Shared utility: format a snapshot diff result into a markdown block
 * suitable for prepending to a narrative.
 */

import type { ToolCallEntry } from "../../lib/agent-loop.js";

export interface DiffData {
  changed: boolean;
  added: string[];
  removed: string[];
  statusChanges: Array<{ key: string; was: string; now: string }>;
  baselineTimestamp: string | null;
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

  return `> **Changes since ${diff.baselineTimestamp}:** ${parts.join("; ")}`;
}
