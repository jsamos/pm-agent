import type { Client } from "@modelcontextprotocol/client";
import type { LLM, Message, ToolDefinition, LLMResponse } from "./llm.js";
import type { ToolCallEntry } from "./agent-loop.js";
import { callTool } from "./connection.js";

/**
 * Look up a prior tool's result by tool name from the call log.
 * Searches backwards so the most recent invocation wins.
 * Extracts the content field specified by `field` (default: "narrative").
 * Returns the string content, or null if not found.
 */
export function resolveContentRef(
  log: ToolCallEntry[] | undefined,
  toolName: string,
  field: string = "narrative",
): string | null {
  if (!log) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].tool !== toolName) continue;
    const result = log[i].result as Record<string, unknown> | null;
    if (result && typeof result[field] === "string") {
      return result[field] as string;
    }
  }
  return null;
}

export interface ExecutionMeta {
  attempt: number;
  strategy?: string;
  workflowName: string;
  stepName: string;
  [key: string]: unknown;
}

export interface ExecutionContext {
  /** Call an MCP tool by name with params. */
  callTool(name: string, params: Record<string, unknown>): Promise<unknown>;

  /** List available MCP tools. */
  listTools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]>;

  /** LLM access for agent reasoning. */
  llm: LLM;

  /** Agent configuration (project keys, roster, etc.) */
  config: Record<string, unknown>;

  /** Current execution metadata (attempt number, strategy, etc.) */
  meta: ExecutionMeta;

  /** Tool call log from the current agent loop (tools can read prior results). */
  toolCallLog?: ToolCallEntry[];

  /**
   * Convenience: run an LLM tool-use loop.
   * Sends messages to the LLM with MCP tools available. When the LLM requests
   * tool calls, executes them via MCP and feeds results back. Loops until the
   * LLM produces a final text response.
   */
  runAgentLoop(
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<string>;
}

export interface CreateContextOptions {
  mcpClient?: Client | (() => Promise<Client>);
  llm: LLM;
  config?: Record<string, unknown>;
  workflowName?: string;
  stepName?: string;
}

export function createContext(options: CreateContextOptions): ExecutionContext {
  const { llm, config = {} } = options;

  let _mcpClient: Client | null = null;

  async function getMcpClient(): Promise<Client> {
    if (_mcpClient) return _mcpClient;
    if (!options.mcpClient) throw new Error("No MCP connection configured. This tool requires an external service.");
    if (typeof options.mcpClient === "function") {
      _mcpClient = await options.mcpClient();
    } else {
      _mcpClient = options.mcpClient;
    }
    return _mcpClient;
  }

  const meta: ExecutionMeta = {
    attempt: 1,
    workflowName: options.workflowName || "default",
    stepName: options.stepName || "unknown",
  };

  const context: ExecutionContext = {
    async callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
      const client = await getMcpClient();
      const result = await callTool(client, name, params);
      if (result.isError) {
        throw new Error(`Tool '${name}' returned error: ${JSON.stringify(result.content)}`);
      }
      // Extract text content from MCP response
      const textBlock = result.content.find(
        (block: unknown) => (block as Record<string, unknown>).type === "text"
      ) as { text: string } | undefined;

      if (!textBlock) return result.content;

      try {
        return JSON.parse(textBlock.text);
      } catch {
        return textBlock.text;
      }
    },

    async listTools() {
      const client = await getMcpClient();
      const { tools } = await client.listTools();
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },

    llm,
    config,
    meta,

    async runAgentLoop(
      messages: Message[],
      tools?: ToolDefinition[]
    ): Promise<string> {
      const availableTools = tools || await getToolDefinitions();

      let conversation = [...messages];
      const maxIterations = 10;

      for (let i = 0; i < maxIterations; i++) {
        const response: LLMResponse = await llm.generateWithTools(
          conversation,
          availableTools
        );

        if (response.finishReason === "stop" || response.toolCalls.length === 0) {
          return response.content || "";
        }

        // LLM wants to call tools — execute them
        conversation.push({
          role: "assistant",
          content: response.content || "",
          toolCalls: response.toolCalls,
        });

        for (const tc of response.toolCalls) {
          try {
            const toolResult = await context.callTool(tc.name, tc.arguments);
            conversation.push({
              role: "tool",
              content: typeof toolResult === "string"
                ? toolResult
                : JSON.stringify(toolResult),
              toolCallId: tc.id,
            });
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            conversation.push({
              role: "tool",
              content: JSON.stringify({ error: errMsg }),
              toolCallId: tc.id,
            });
          }
        }
      }

      throw new Error("Agent loop exceeded max iterations without producing a final response");
    },
  };

  async function getToolDefinitions(): Promise<ToolDefinition[]> {
    const tools = await context.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      parameters: (t.inputSchema as Record<string, unknown>) || { type: "object", properties: {} },
    }));
  }

  return context;
}
