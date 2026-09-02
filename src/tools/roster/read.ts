/**
 * Tool: read_roster
 * Reads the current roster from disk.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool } from "../registry.js";
import type { RosterFile } from "./types.js";

export type { RosterEntry, RosterFile, RosterNotionConfig, RosterSlackConfig, RosterWorkPage } from "./types.js";

const ROSTER_PATH = resolve("src/config/roster.json");

export const readRosterTool: Tool = {
  name: "read_roster",
  description:
    "Read the current team roster. Returns resolved entries (Jira identity, optional roles, notion.homepageUrl, slack.channelId, workPages) and any unresolved names.",
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

/** Load roster file from disk — for tools that need roster without a tool call. */
export function loadRosterFile(): RosterFile {
  if (!existsSync(ROSTER_PATH)) {
    return { resolved: [], unresolved: [], generatedAt: "" };
  }
  return JSON.parse(readFileSync(ROSTER_PATH, "utf-8"));
}
