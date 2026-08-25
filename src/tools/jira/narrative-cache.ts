/**
 * Narrative cache: persist per-group prose and rendered markdown
 * after each sprint narrative generation. Used for selective regeneration —
 * only groups whose tickets changed need fresh LLM calls.
 *
 * Keyed by JQL thread hash (same MD5 as snapshot cache).
 */

import { createHash } from "node:crypto";
import { cacheAppend, cacheReadAll, cacheFilter, cacheClear, cacheRemoveBefore, cacheCompact, cacheCount } from "../../lib/cache.js";
import type { GroupNarrative } from "./generate-sprint-narrative.js";
import type { IssueGroup } from "./group-issues.js";

const CACHE_KEY = "narrative_cache";

export interface GroupSection {
  groupKey: string;
  groupLabel: string;
  issueKeys: string[];
  prose: GroupNarrative;
  renderedMarkdown: string;
}

export interface NarrativeCacheEntry {
  thread: string;
  groupBy: string[];
  sections: GroupSection[];
}

export function computeThread(jql: string): string {
  return createHash("md5").update(jql).digest("hex");
}

/**
 * Recursively collect all issue keys from a group and its subgroups.
 */
export function collectGroupIssueKeys(group: IssueGroup): string[] {
  const keys: string[] = group.issues.map((i) => i.key);
  if (group.subGroups) {
    for (const sg of group.subGroups) {
      keys.push(...collectGroupIssueKeys(sg));
    }
  }
  return keys;
}

/**
 * Load the most recent narrative cache entry matching a thread hash and groupBy.
 * Returns null if no match found or groupBy doesn't match.
 */
export function loadNarrativeCache(
  thread: string,
  groupBy: string[],
): NarrativeCacheEntry | null {
  const all = cacheReadAll<NarrativeCacheEntry>(CACHE_KEY);
  for (let i = all.length - 1; i >= 0; i--) {
    const entry = all[i].data;
    if (entry.thread !== thread) continue;
    if (entry.groupBy.length !== groupBy.length) continue;
    if (entry.groupBy.every((k, idx) => k === groupBy[idx])) {
      return entry;
    }
  }
  return null;
}

/**
 * Save a narrative cache entry.
 */
export function saveNarrativeCache(entry: NarrativeCacheEntry): void {
  cacheAppend(CACHE_KEY, entry);
}

/** Composite key for compact: one latest entry per JQL thread + groupBy. */
export function narrativeCacheCompactKey(entry: NarrativeCacheEntry): string {
  return `${entry.thread}:${entry.groupBy.join(",")}`;
}

/** Remove all narrative cache entries for a JQL thread hash. */
export function removeNarrativeCacheForThread(thread: string): number {
  return cacheFilter<NarrativeCacheEntry>(CACHE_KEY, (entry) => entry.data.thread !== thread);
}

/** Remove entries matching a specific thread and groupBy. */
export function removeNarrativeCacheEntry(thread: string, groupBy: string[]): number {
  return cacheFilter<NarrativeCacheEntry>(CACHE_KEY, (entry) => {
    const data = entry.data;
    if (data.thread !== thread) return true;
    if (data.groupBy.length !== groupBy.length) return true;
    return !data.groupBy.every((k, idx) => k === groupBy[idx]);
  });
}

/** Keep only the latest entry per thread + groupBy. */
export function compactNarrativeCache(): number {
  return cacheCompact<NarrativeCacheEntry>(CACHE_KEY, narrativeCacheCompactKey);
}

/** Remove all narrative cache entries. */
export function clearNarrativeCache(): number {
  return cacheClear(CACHE_KEY);
}
