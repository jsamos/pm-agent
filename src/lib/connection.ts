import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export interface ConnectionConfig {
  serverUrl: string;
  name?: string;
}

export interface ToolCallResult {
  content: unknown[];
  isError: boolean;
  raw: unknown;
}

const DEFAULT_CONFIG: ConnectionConfig = {
  serverUrl: "https://mcp.atlassian.com/v1/mcp/authv2",
  name: "atlassian",
};

export async function connect(
  config: ConnectionConfig = DEFAULT_CONFIG
): Promise<Client> {
  const client = new Client({
    name: "pm-harness",
    version: "0.1.0",
  });

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "mcp-remote@latest", config.serverUrl],
    stderr: "ignore",
  });

  await client.connect(transport);
  return client;
}

export async function callTool(
  client: Client,
  name: string,
  params: Record<string, unknown>
): Promise<ToolCallResult> {
  const result = await client.callTool({ name, arguments: params });

  return {
    content: result.content as unknown[],
    isError: !!result.isError,
    raw: result,
  };
}

export async function disconnect(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // mcp-remote emits AbortError during shutdown — safe to ignore
  }
}

export { DEFAULT_CONFIG };
