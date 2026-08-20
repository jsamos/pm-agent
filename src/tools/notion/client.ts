/**
 * Shared lazy MCP client for Notion tools.
 * All Notion tools import from here instead of managing their own connections.
 */

import type { Client } from "@modelcontextprotocol/client";
import { connect, callTool as mcpCallTool, type ToolCallResult } from "../../lib/connection.js";

let _client: Client | null = null;

export async function getNotionClient(): Promise<Client> {
  if (!_client) {
    _client = await connect("notion");
  }
  return _client;
}

export async function callNotionTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<ToolCallResult> {
  const client = await getNotionClient();
  const result = await mcpCallTool(client, toolName, params);

  if (result.isError) {
    const text = result.content
      .filter((b: unknown) => (b as Record<string, unknown>).type === "text")
      .map((b: unknown) => (b as { text: string }).text)
      .join("\n");
    throw new Error(`Notion MCP error (${toolName}): ${text || "unknown error"}`);
  }

  return result;
}

export function extractTextContent(result: ToolCallResult): string {
  const textBlock = result.content.find(
    (block: unknown) => (block as Record<string, unknown>).type === "text"
  ) as { text: string } | undefined;

  if (!textBlock) {
    throw new Error("Notion MCP returned no text content");
  }

  return textBlock.text;
}
