/**
 * Tool: write_roster
 * Adds, removes, or updates roster entries and publishing config.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool } from "../registry.js";
import type { RosterFile } from "./types.js";
import { applyRosterWrite, type WriteRosterAction } from "./mutations.js";

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
  description:
    "Update the team roster. Actions: 'add' (person + optional roles/notion/slack/workPages), 'remove', 'set_roles', 'set_notion' (homepageUrl), 'set_slack' (channelId), 'add_work_page' (page URL + epics[] + optional name), 'remove_work_page' (page URL or display name), 'remove_epics_from_work_page' (page URL or name + epics[]), 'set_work_page_name' (page URL or name + name). All actions require accountId.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "add",
          "remove",
          "set_roles",
          "set_notion",
          "set_slack",
          "add_work_page",
          "remove_work_page",
          "remove_epics_from_work_page",
          "set_work_page_name",
        ],
        description: "Roster update action",
      },
      name: {
        type: "string",
        description:
          "For add: input name. For add_work_page: optional work page display name. For set_work_page_name: required work page display name.",
      },
      shortName: { type: "string", description: "Short display name (first name)" },
      accountId: { type: "string", description: "Jira account ID" },
      displayName: { type: "string", description: "Full display name from Jira" },
      roles: {
        type: "array",
        items: { type: "string" },
        description: 'Optional roles — e.g. ["qa"] for QA engineers',
      },
      homepageUrl: { type: "string", description: "For set_notion: Notion homepage URL" },
      channelId: { type: "string", description: "For set_slack: Slack channel ID" },
      page: {
        type: "string",
        description:
          "Notion work page URL or display name (for add_work_page, remove_work_page, remove_epics_from_work_page, set_work_page_name)",
      },
      epics: {
        type: "array",
        items: { type: "string" },
        description: "For add_work_page / remove_epics_from_work_page: Jira epic keys",
      },
    },
    required: ["action", "accountId"],
  },

  async execute(args) {
    const input = args as {
      action: WriteRosterAction;
      accountId: string;
      name?: string;
      shortName?: string;
      displayName?: string;
      roles?: string[];
      homepageUrl?: string;
      channelId?: string;
      page?: string;
      epics?: string[];
    };

    const roster = loadRoster();
    const result = applyRosterWrite(roster, input);
    if (result.success) {
      saveRoster(roster);
    }
    return result;
  },
};
