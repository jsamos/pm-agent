/**
 * Tool: resolve_epic_work_page
 * Look up a roster member's Notion work page URL for a Jira epic key.
 */

import type { Tool } from "../registry.js";
import { loadRosterFile } from "./read.js";
import { resolveEpicWorkPage } from "../../lib/roster-work-pages.js";

export const resolveEpicWorkPageTool: Tool = {
  name: "resolve_epic_work_page",
  description:
    "Resolve a roster member's Notion work page for an epic. Returns the page URL when workPages maps the epic, or found: false with reason not created or assignee not on roster. Use after resolve_assignees when publishing assignee-filtered epic narratives.",
  parameters: {
    type: "object",
    properties: {
      accountId: {
        type: "string",
        description: "Jira account ID from resolve_assignees",
      },
      epicKey: {
        type: "string",
        description: "Jira epic key (e.g. PROJ-100)",
      },
    },
    required: ["accountId", "epicKey"],
  },

  async execute(args) {
    const accountId = args.accountId as string;
    const epicKey = args.epicKey as string;

    if (!accountId?.trim()) {
      throw new Error("accountId is required");
    }
    if (!epicKey?.trim()) {
      throw new Error("epicKey is required");
    }

    const roster = loadRosterFile();
    return resolveEpicWorkPage(roster.resolved, accountId.trim(), epicKey.trim());
  },
};
