/**
 * Tool: search_slack_users
 * Search for Slack users by name, email, or profile attributes.
 * Wraps the slack_search_users MCP tool.
 */

import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import { callSlackTool, extractTextContent } from "./client.js";
import { trace } from "../../lib/agent-loop.js";

export interface SlackUser {
  userId: string;
  displayName: string;
  realName: string;
  email: string | null;
}

/**
 * The Slack MCP returns markdown-formatted results inside a JSON wrapper:
 * { results: "# Search Results for: ...\n### Result 1\nName: ...\nUser ID: ...\n..." }
 *
 * Each result block has fields like Name, User ID, Title, Email on separate lines.
 */
export function parseSlackUsers(raw: unknown): SlackUser[] {
  if (typeof raw === "string") {
    throw new Error(`Unexpected Slack response (raw string): ${raw.slice(0, 200)}`);
  }

  const data = raw as Record<string, unknown>;
  if (!data.results || typeof data.results !== "string") {
    throw new Error(
      `Unexpected Slack response shape: ${JSON.stringify(Object.keys(data))} — expected { results: string }`
    );
  }

  const results = data.results;

  const lower = results.toLowerCase();
  if (lower.includes("error")) {
    throw new Error(`Slack user search failed: ${results.slice(0, 300)}`);
  }
  if (lower.includes("0 results")) return [];

  const blocks = results.split(/###\s+Result\s+\d+/);
  const users: SlackUser[] = [];

  for (const block of blocks) {
    const field = (key: string): string => {
      const match = block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      return match ? match[1].trim() : "";
    };

    const userId = field("User ID");
    if (!userId) continue;

    users.push({
      userId,
      displayName: field("Name"),
      realName: field("Name"),
      email: field("Email") || null,
    });
  }

  return users;
}

async function searchSlack(query: string): Promise<SlackUser[]> {
  const result = await callSlackTool("slack_search_users", { query });
  const content = extractTextContent(result);

  trace("slack_mcp_response", {
    tool: "search_slack_users",
    query,
    raw: JSON.stringify(content).slice(0, 1000),
  });

  return parseSlackUsers(content);
}

export const searchSlackUsersTool: Tool = {
  name: "search_slack_users",
  description:
    "Search for Slack users by name or email. Returns matching users with their user IDs. Use the user ID as channel_id in send_slack_message to DM someone.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Name, email, or profile attribute to search for (e.g. 'Alice', 'alice@example.com')",
      },
    },
    required: ["query"],
  },

  async execute(args, _context: ExecutionContext) {
    const query = args.query as string;
    if (!query) throw new Error("query is required");

    let users = await searchSlack(query);

    if (users.length === 0 && query.includes(" ")) {
      const firstName = query.split(/\s+/)[0];
      process.stderr.write(`  [slack] No results for "${query}", retrying with "${firstName}"\n`);
      trace("slack_search_retry", { original: query, retry: firstName });
      users = await searchSlack(firstName);
    }

    const summary = users.length > 0
      ? `Found ${users.length} user(s): ${users.map((u) => `${u.realName || u.displayName} (${u.userId})`).join(", ")}`
      : `No users found for "${query}"`;

    return { users, summary };
  },
};
