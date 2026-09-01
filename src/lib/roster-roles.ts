/**
 * Roster role lookup and role-aware narrative hint blocks.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { RosterEntry } from "../tools/roster/read.js";
import type { JiraIssue } from "../tools/jira/search-issues.js";

const ROSTER_PATH = resolve("src/config/roster.json");

export type RosterRole = "qa";

export function isQaStatus(status: string): boolean {
  return status.trim().toLowerCase() === "qa";
}

export function loadRosterEntries(): RosterEntry[] {
  if (!existsSync(ROSTER_PATH)) return [];
  const data = JSON.parse(readFileSync(ROSTER_PATH, "utf-8"));
  return data.resolved || [];
}

function namesForEntry(entry: RosterEntry): string[] {
  return [entry.displayName, entry.shortName, entry.name]
    .filter(Boolean)
    .map((n) => n.toLowerCase());
}

/** Map normalized assignee name → roles from roster. */
export function buildRosterRoleIndex(roster: RosterEntry[]): Map<string, Set<RosterRole>> {
  const index = new Map<string, Set<RosterRole>>();
  for (const entry of roster) {
    const roles = new Set((entry.roles ?? []) as RosterRole[]);
    if (roles.size === 0) continue;
    for (const name of namesForEntry(entry)) {
      index.set(name, roles);
    }
  }
  return index;
}

export function assigneeHasRole(
  assignee: string | null | undefined,
  role: RosterRole,
  roster: RosterEntry[] = loadRosterEntries(),
): boolean {
  if (!assignee) return false;
  const index = buildRosterRoleIndex(roster);
  return index.get(assignee.toLowerCase())?.has(role) ?? false;
}

export function listQaEngineers(roster: RosterEntry[] = loadRosterEntries()): string[] {
  return roster
    .filter((e) => e.roles?.includes("qa"))
    .map((e) => e.displayName)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Per-issue QA framing hints when any issue is in QA status.
 * Returns null when no QA-status issues are present.
 */
export function buildQaLanguageHints(
  issues: JiraIssue[],
  roster: RosterEntry[] = loadRosterEntries(),
): string | null {
  const qaIssues = issues.filter((i) => isQaStatus(i.status));
  if (qaIssues.length === 0) return null;

  const qaEngineers = listQaEngineers(roster);
  const lines = [
    "--- QA STATUS LANGUAGE (assignee role) ---",
  ];

  if (qaEngineers.length > 0) {
    lines.push(`QA engineers on this team: ${qaEngineers.join(", ")}`);
  } else {
    lines.push("No QA engineers are configured in the roster. Treat all QA-status issues as awaiting QA.");
  }

  lines.push(
    "For each issue with [Status: QA]:",
    '- Assignee is a QA engineer → active validation language ("QA is validating…", conditional wording).',
    '- Assignee is NOT a QA engineer → awaiting QA ("Awaiting QA validation…", "Handed off for QA testing…"). Do NOT describe the assignee as actively testing.',
    "",
    "Per issue:",
  );

  for (const issue of qaIssues) {
    const active = assigneeHasRole(issue.assignee, "qa", roster);
    const mode = active
      ? "active QA validation (assignee is a QA engineer)"
      : "awaiting QA (assignee is not a QA engineer)";
    lines.push(`- ${issue.key} · ${issue.assignee || "Unassigned"} · QA → ${mode}`);
  }

  return lines.join("\n");
}
