/**
 * Tool: search_users
 * Searches Jira for users matching a query string.
 * Returns atlassian accounts only (filters out customers).
 */

import type { Tool } from "../registry.js";
import { callJiraTool, extractTextContent } from "./client.js";

export interface JiraUser {
  accountId: string;
  displayName: string;
}

export const searchUsersTool: Tool = {
  name: "search_users",
  description: "Search Jira for users by name. Returns matching atlassian accounts with accountId and displayName.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name or partial name to search for" },
    },
    required: ["query"],
  },

  async execute(args, context) {
    const { query } = args as { query: string };

    const result = await callJiraTool("lookupJiraAccountId", {
      cloudId: context.config.cloudId as string,
      searchString: query,
    });

    if (result.isError) {
      throw new Error(`lookupJiraAccountId failed: ${JSON.stringify(result.content)}`);
    }

    const raw = extractTextContent(result) as { data?: { users?: { users?: Array<Record<string, unknown>> } } };
    const users = (raw.data?.users?.users || [])
      .filter((u) => u.accountType === "atlassian")
      .map((u) => ({ accountId: u.accountId as string, displayName: u.displayName as string }));

    return { users, query };
  },
};
