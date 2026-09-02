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
