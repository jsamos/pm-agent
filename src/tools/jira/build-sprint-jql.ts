/**
 * Tool: build_sprint_jql
 * Builds a JQL query for sprint issues from structured params.
 * Projects default to config. Assignee IDs are quoted correctly.
 */

import type { Tool } from "../registry.js";

export const buildSprintJqlTool: Tool = {
  name: "build_sprint_jql",
  description:
    "Build a JQL query for current sprint issues. Always includes projects (from config), open sprints, and assignee filter. Assignees are required.",
  parameters: {
    type: "object",
    properties: {
      assignees: {
        type: "array",
        items: { type: "string" },
        description: "Jira account IDs to filter by (required)",
      },
      statusCategories: {
        type: "array",
        items: { type: "string" },
        description: "Status categories to include (e.g. [\"In Progress\", \"To Do\"]). Omit to include all.",
      },
    },
    required: ["assignees"],
  },

  async execute(args, context) {
    const { assignees, statusCategories } = args as { assignees: string[]; statusCategories?: string[] };

    const configProjects = (context.config.projects as string[]) || [];
    if (configProjects.length === 0) {
      throw new Error("No projects configured or specified");
    }

    if (!assignees || assignees.length === 0) {
      throw new Error("Assignees are required — use resolve_assignees first to get account IDs");
    }

    const clauses: string[] = [];

    if (configProjects.length === 1) {
      clauses.push(`project = ${configProjects[0]}`);
    } else {
      clauses.push(`project in (${configProjects.join(", ")})`);
    }

    clauses.push("sprint in openSprints()");

    const quoted = assignees.map((id) => `"${id}"`).join(", ");
    clauses.push(`assignee in (${quoted})`);

    if (statusCategories && statusCategories.length > 0) {
      const quoted = statusCategories.map((c) => `"${c}"`).join(", ");
      clauses.push(`statusCategory in (${quoted})`);
    }

    const jql = clauses.join(" AND ") + " ORDER BY status ASC";

    return { jql, projects: configProjects, assigneeCount: assignees.length };
  },
};
