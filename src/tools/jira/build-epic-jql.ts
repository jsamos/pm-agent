/**
 * Tool: build_epic_jql
 * Builds a JQL query to fetch an epic and its direct children.
 * Supports multiple epic keys (for grouped rollups) and optional assignee filter.
 *
 * TODO: When ADF description support is added, we may want a separate
 * fetch_issue_detail tool that calls getJiraIssue with responseContentFormat: adf
 * to detect strikethrough and rich formatting in issue descriptions.
 */

import type { Tool } from "../registry.js";

export const buildEpicJqlTool: Tool = {
  name: "build_epic_jql",
  description:
    "Build a JQL query to fetch epic(s) and their direct children. Takes one or more epic keys and an optional assignee account ID.",
  parameters: {
    type: "object",
    properties: {
      epicKeys: {
        type: "array",
        items: { type: "string" },
        description: "One or more Jira epic keys (e.g. [\"PROJ-100\", \"PROJ-200\"])",
      },
      assignee: {
        type: "string",
        description: "Optional Jira account ID to filter by assignee",
      },
    },
    required: ["epicKeys"],
  },

  async execute(args) {
    const { epicKeys, assignee } = args as { epicKeys: string[]; assignee?: string };

    if (!epicKeys || epicKeys.length === 0) {
      throw new Error("At least one epic key is required");
    }

    if (assignee && !assignee.includes(":") && !assignee.match(/^[a-f0-9]{24}$/)) {
      throw new Error(
        `"${assignee}" looks like a display name, not a Jira account ID. ` +
        `Use resolve_assignees first to get the account ID, then pass it here.`
      );
    }

    const keyList = epicKeys.join(", ");
    const clauses: string[] = [];

    clauses.push(`(key in (${keyList}) OR parent in (${keyList}))`);

    if (assignee) {
      clauses.push(`assignee = "${assignee}"`);
    }

    const jql = clauses.join(" AND ") + " ORDER BY issuetype ASC, status ASC";

    return { jql, epicKeys, assigneeFiltered: !!assignee };
  },
};
