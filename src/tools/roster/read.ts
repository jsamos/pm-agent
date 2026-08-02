/**
 * Tool: read_roster
 * Reads the current roster from disk.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool } from "../registry.js";

export interface RosterEntry {
  name: string;
  shortName: string;
  accountId: string;
  displayName: string;
}

export interface RosterFile {
  resolved: RosterEntry[];
  unresolved: string[];
  generatedAt: string;
}

const ROSTER_PATH = resolve("src/config/roster.json");

export const readRosterTool: Tool = {
  name: "read_roster",
  description: "Read the current team roster. Returns all resolved entries (name, shortName, accountId, displayName) and any unresolved names.",
  parameters: {
    type: "object",
    properties: {},
  },

  async execute() {
    if (!existsSync(ROSTER_PATH)) {
      return { resolved: [], unresolved: [], exists: false };
    }
    const data: RosterFile = JSON.parse(readFileSync(ROSTER_PATH, "utf-8"));
    return { resolved: data.resolved, unresolved: data.unresolved, exists: true };
  },
};
