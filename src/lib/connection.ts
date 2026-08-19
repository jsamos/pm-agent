import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export interface ConnectionConfig {
  serverUrl: string;
  name: string;
  staticOAuthClientInfo?: (() => Record<string, string>) | Record<string, string>;
}

export interface ToolCallResult {
  content: unknown[];
  isError: boolean;
  raw: unknown;
}

const MCP_REMOTE_PKG = "@automattic/mcp-remote@latest";

const SERVICES: Record<string, ConnectionConfig> = {
  jira: { serverUrl: "https://mcp.atlassian.com/v1/mcp/authv2", name: "atlassian" },
  slack: {
    serverUrl: "https://mcp.slack.com/mcp",
    name: "slack",
    staticOAuthClientInfo: () => {
      const id = process.env.SLACK_CLIENT_ID;
      const secret = process.env.SLACK_CLIENT_SECRET;
      if (!id || !secret) throw new Error("SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must be set in .env");
      return { client_id: id, client_secret: secret };
    },
  },
};

export function listServices(): string[] {
  return Object.keys(SERVICES);
}

export function getServiceConfig(service: string): ConnectionConfig {
  const config = SERVICES[service];
  if (!config) {
    const available = listServices().join(", ");
    throw new Error(`Unknown service "${service}". Available: ${available}`);
  }
  return config;
}

export async function connect(service: string = "jira"): Promise<Client> {
  const config = getServiceConfig(service);

  const client = new Client({
    name: "pm-harness",
    version: "0.1.0",
  });

  const args = ["-y", MCP_REMOTE_PKG, config.serverUrl];
  if (config.staticOAuthClientInfo) {
    const oauthInfo = typeof config.staticOAuthClientInfo === "function"
      ? config.staticOAuthClientInfo()
      : config.staticOAuthClientInfo;
    args.push("3334");
    args.push("--static-oauth-client-info", JSON.stringify(oauthInfo));
  }

  const transport = new StdioClientTransport({
    command: "npx",
    args,
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
