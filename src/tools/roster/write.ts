/**
 * Tool: write_roster
 * Adds or removes an entry from the roster.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool } from "../registry.js";
import type { RosterFile, RosterEntry } from "./read.js";

const ROSTER_PATH = resolve("src/config/roster.json");

function loadRoster(): RosterFile {
  if (!existsSync(ROSTER_PATH)) {
    return { resolved: [], unresolved: [], generatedAt: "" };
  }
  return JSON.parse(readFileSync(ROSTER_PATH, "utf-8"));
}

function saveRoster(roster: RosterFile): void {
  roster.generatedAt = new Date().toISOString();
  writeFileSync(ROSTER_PATH, JSON.stringify(roster, null, 2));
}

export const writeRosterTool: Tool = {
  name: "write_roster",
  description: "Add or remove a person from the team roster. Action 'add' requires name, accountId, and displayName. Action 'remove' requires accountId.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["add", "remove"], description: "Whether to add or remove" },
      name: { type: "string", description: "Input name (what the user called them)" },
      shortName: { type: "string", description: "Short display name (first name)" },
      accountId: { type: "string", description: "Jira account ID" },
      displayName: { type: "string", description: "Full display name from Jira" },
    },
    required: ["action", "accountId"],
  },

  async execute(args, context) {
    const { action, name, shortName, accountId, displayName } = args as {
      action: "add" | "remove";
      name?: string;
      shortName?: string;
      accountId: string;
      displayName?: string;
    };

    const roster = loadRoster();

    if (action === "add") {
      const exists = roster.resolved.find((r) => r.accountId === accountId);
      if (exists) {
        return { success: true, message: `Already in roster: ${exists.displayName}` };
      }

      const entry: RosterEntry = {
        name: name || displayName || accountId,
        shortName: shortName || (name || "").split(" ")[0],
        accountId,
        displayName: displayName || name || accountId,
      };
      roster.resolved.push(entry);
      saveRoster(roster);
      return { success: true, message: `Added ${entry.displayName}`, total: roster.resolved.length };
    }

    if (action === "remove") {
      const before = roster.resolved.length;
      roster.resolved = roster.resolved.filter((r) => r.accountId !== accountId);
      if (roster.resolved.length === before) {
        return { success: false, message: `Account ${accountId} not found in roster` };
      }
      saveRoster(roster);
      return { success: true, message: `Removed`, total: roster.resolved.length };
    }

    return { success: false, message: `Unknown action: ${action}` };
  },
};
