/**
 * Shared lazy MCP client for Jira/Atlassian tools.
 * All Jira tools import from here instead of managing their own connections.
 */

import type { Client } from "@modelcontextprotocol/client";
import { connect, callTool as mcpCallTool, type ToolCallResult } from "../../lib/connection.js";

let _client: Client | null = null;

export async function getJiraClient(): Promise<Client> {
  if (!_client) {
    _client = await connect();
  }
  return _client;
}

export async function callJiraTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<ToolCallResult> {
  const client = await getJiraClient();
  return mcpCallTool(client, toolName, params);
}

export function extractTextContent(result: ToolCallResult): unknown {
  const textBlock = result.content.find(
    (block: unknown) => (block as Record<string, unknown>).type === "text"
  ) as { text: string } | undefined;

  return textBlock ? JSON.parse(textBlock.text) : {};
}
