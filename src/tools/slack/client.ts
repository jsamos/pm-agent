/**
 * Shared lazy MCP client for Slack tools.
 * All Slack tools import from here instead of managing their own connections.
 */

import type { Client } from "@modelcontextprotocol/client";
import { connect, callTool as mcpCallTool, type ToolCallResult } from "../../lib/connection.js";

let _client: Client | null = null;

export async function getSlackClient(): Promise<Client> {
  if (!_client) {
    _client = await connect("slack");
  }
  return _client;
}

export async function callSlackTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<ToolCallResult> {
  const client = await getSlackClient();
  const result = await mcpCallTool(client, toolName, params);

  if (result.isError) {
    const text = result.content
      .filter((b: unknown) => (b as Record<string, unknown>).type === "text")
      .map((b: unknown) => (b as { text: string }).text)
      .join("\n");
    throw new Error(`Slack MCP error (${toolName}): ${text || "unknown error"}`);
  }

  return result;
}

export function extractTextContent(result: ToolCallResult): unknown {
  const textBlock = result.content.find(
    (block: unknown) => (block as Record<string, unknown>).type === "text"
  ) as { text: string } | undefined;

  if (!textBlock) {
    throw new Error("Slack MCP returned no text content");
  }

  try {
    return JSON.parse(textBlock.text);
  } catch {
    return textBlock.text;
  }
}
