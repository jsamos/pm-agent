/**
 * Tool: resolve_assignees
 * Resolves assignee filter intent into Jira account IDs.
 * - "roster" → reads roster.json for all account IDs
 * - string[] → looks up specific names from the roster (fuzzy)
 *
 * Matching strategy (first match wins):
 * 1. Exact case-insensitive match on shortName/displayName/name
 * 2. Prefix match (3+ chars)
 * 3. Levenshtein distance ≤ 2
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool } from "../registry.js";

const ROSTER_PATH = resolve("src/config/roster.json");

interface RosterEntry {
  name: string;
  shortName: string;
  accountId: string;
  displayName: string;
}

function loadRoster(): RosterEntry[] {
  if (!existsSync(ROSTER_PATH)) return [];
  const data = JSON.parse(readFileSync(ROSTER_PATH, "utf-8"));
  return data.resolved || [];
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function getNames(entry: RosterEntry): string[] {
  return [entry.shortName, entry.displayName, entry.name]
    .filter(Boolean)
    .map((n) => n.toLowerCase());
}

function findByName(roster: RosterEntry[], query: string): RosterEntry | undefined {
  const lower = query.toLowerCase();

  // 1. Exact match
  const exact = roster.find((r) => getNames(r).includes(lower));
  if (exact) return exact;

  // 2. Prefix match (query must be 3+ chars)
  if (lower.length >= 3) {
    const prefix = roster.find((r) =>
      getNames(r).some((n) => n.startsWith(lower))
    );
    if (prefix) return prefix;
  }

  // 3. Levenshtein ≤ 2
  let bestMatch: RosterEntry | undefined;
  let bestDist = 3;
  for (const entry of roster) {
    for (const name of getNames(entry)) {
      const dist = levenshtein(lower, name);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = entry;
      }
    }
  }
  return bestMatch;
}

export const resolveAssigneesTool: Tool = {
  name: "resolve_assignees",
  description:
    'Resolve assignee filter to Jira account IDs. Use filter "roster" for the full team, or pass specific names to look up from the roster.',
  parameters: {
    type: "object",
    properties: {
      filter: {
        description: '"roster" for the full team, or an array of names to resolve (e.g. ["Alice", "Bob"])',
      },
    },
    required: ["filter"],
  },

  async execute(args) {
    const { filter } = args as { filter: "roster" | string[] };

    const roster = loadRoster();
    if (roster.length === 0) {
      throw new Error("Roster is empty — run the roster agent first to populate it");
    }

    if (filter === "roster") {
      return {
        accountIds: roster.map((r) => r.accountId),
        resolved: roster.map((r) => ({ name: r.displayName, accountId: r.accountId })),
      };
    }

    // Specific names
    const resolved: Array<{ name: string; accountId: string }> = [];
    const unresolved: string[] = [];

    for (const name of filter) {
      const match = findByName(roster, name);
      if (match) {
        resolved.push({ name: match.displayName, accountId: match.accountId });
      } else {
        unresolved.push(name);
      }
    }

    if (unresolved.length > 0) {
      return {
        accountIds: resolved.map((r) => r.accountId),
        resolved,
        unresolved,
        warning: `Could not resolve: ${unresolved.join(", ")}. They may not be in the roster.`,
      };
    }

    return { accountIds: resolved.map((r) => r.accountId), resolved };
  },
};
