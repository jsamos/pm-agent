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
import { EXCLUDE_CLOSED_JQL } from "./build-sprint-jql.js";

/** Child issues only — Bugs are sprint stabilization work, not epic delivery scope. */
export const EXCLUDE_BUG_JQL = 'issuetype != "Bug"';

export const buildEpicJqlTool: Tool = {
  name: "build_epic_jql",
  description:
    "Build a JQL query to fetch epic(s) and their direct children. Closed and Bug child issues are always excluded; epic keys themselves are always returned. Takes one or more epic keys and an optional assignee account ID.",
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
      statusCategories: {
        type: "array",
        items: { type: "string" },
        description: "Status categories to include for child issues (e.g. [\"In Progress\", \"To Do\"]). Omit to include all. The epic itself is always returned.",
      },
    },
    required: ["epicKeys"],
  },

  async execute(args) {
    const { epicKeys, assignee, statusCategories } = args as { epicKeys: string[]; assignee?: string; statusCategories?: string[] };

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

    const hasChildFilters = !!assignee || (statusCategories && statusCategories.length > 0);

    const childClauses = [`parent in (${keyList})`, EXCLUDE_CLOSED_JQL, EXCLUDE_BUG_JQL];
    if (assignee) childClauses.push(`assignee = "${assignee}"`);
    if (statusCategories && statusCategories.length > 0) {
      const quoted = statusCategories.map((c) => `"${c}"`).join(", ");
      childClauses.push(`statusCategory in (${quoted})`);
    }

    let jql: string;
    if (hasChildFilters) {
      jql = `key in (${keyList}) OR (${childClauses.join(" AND ")})`;
    } else {
      jql = `(key in (${keyList}) OR (${childClauses.join(" AND ")}))`;
    }

    jql += " ORDER BY issuetype ASC, status ASC";

    return { jql, epicKeys, assigneeFiltered: !!assignee };
  },
};
