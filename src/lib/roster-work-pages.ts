/**
 * Lookup helpers for roster work page mappings (epic → Notion page URL).
 */

import type { RosterEntry, RosterWorkPage } from "../tools/roster/types.js";

/** Find the work page entry whose epics array contains epicKey. */
export function findWorkPageEntry(entry: RosterEntry, epicKey: string): RosterWorkPage | null {
  if (!entry.workPages?.length) return null;
  return entry.workPages.find((wp) => wp.epics.includes(epicKey)) ?? null;
}

/** Resolve epicKey to a Notion page URL for a roster member, or null if unmapped. */
export function resolveWorkPageUrl(entry: RosterEntry, epicKey: string): string | null {
  return findWorkPageEntry(entry, epicKey)?.page ?? null;
}

/**
 * Find a work page by URL (exact) or display name (case-insensitive).
 * URL match takes precedence over name match.
 */
export function findWorkPageByRef(
  entry: RosterEntry,
  pageRef: string,
): RosterWorkPage | undefined {
  if (!entry.workPages?.length) return undefined;
  const ref = pageRef.trim();
  const byUrl = entry.workPages.find((wp) => wp.page === ref);
  if (byUrl) return byUrl;
  const lower = ref.toLowerCase();
  return entry.workPages.find((wp) => wp.name?.toLowerCase() === lower);
}
