/**
 * Shared Bedrock Converse invocation via AWS CLI.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Message, ToolDefinition } from "../llm.js";

const execFileAsync = promisify(execFile);

export interface ConverseOutput {
  output?: {
    message?: {
      role?: string;
      content?: Array<{
        text?: string;
        toolUse?: {
          toolUseId: string;
          name: string;
          input: Record<string, unknown>;
        };
      }>;
    };
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  stopReason?: string;
}

export interface ConverseOptions {
  modelId: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  profile: string;
  region: string;
}

function toConverseMessages(messages: Message[]): unknown[] {
  const out: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      out.push({
        role: "user",
        content: [{ text: `[system]\n${msg.content}` }],
      });
      continue;
    }

    if (msg.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: msg.toolCallId,
              content: [{ text: msg.content }],
            },
          },
        ],
      });
      continue;
    }

    if (msg.role === "assistant" && msg.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: msg.toolCalls.map((tc) => ({
          toolUse: {
            toolUseId: tc.id,
            name: tc.name,
            input: tc.arguments,
          },
        })),
      });
      continue;
    }

    out.push({
      role: msg.role,
      content: [{ text: msg.content }],
    });
  }

  return out;
}

function toToolConfig(tools: ToolDefinition[]): Record<string, unknown> {
  return {
    tools: tools.map((tool) => ({
      toolSpec: {
        name: tool.name,
        description: tool.description,
        inputSchema: { json: tool.parameters },
      },
    })),
  };
}

export async function bedrockConverse(options: ConverseOptions): Promise<ConverseOutput> {
  const args = [
    "bedrock-runtime",
    "converse",
    "--model-id",
    options.modelId,
    "--messages",
    JSON.stringify(toConverseMessages(options.messages)),
    "--inference-config",
    JSON.stringify({
      maxTokens: options.maxTokens ?? 4096,
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
    }),
    "--region",
    options.region,
    "--profile",
    options.profile,
    "--output",
    "json",
  ];

  if (options.tools?.length) {
    args.push("--tool-config", JSON.stringify(toToolConfig(options.tools)));
  }

  const { stdout } = await execFileAsync("aws", args, {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(stdout) as ConverseOutput;
}

export function parseConverseResponse(response: ConverseOutput): {
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  finishReason: "stop" | "tool_calls" | "length" | "unknown";
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
} {
  const blocks = response.output?.message?.content ?? [];
  const textParts: string[] = [];
  const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

  for (const block of blocks) {
    if (block.text) textParts.push(block.text);
    if (block.toolUse) {
      toolCalls.push({
        id: block.toolUse.toolUseId,
        name: block.toolUse.name,
        arguments: block.toolUse.input ?? {},
      });
    }
  }

  let finishReason: "stop" | "tool_calls" | "length" | "unknown" = "unknown";
  if (response.stopReason === "end_turn") finishReason = "stop";
  else if (response.stopReason === "tool_use") finishReason = "tool_calls";
  else if (response.stopReason === "max_tokens") finishReason = "length";
  else if (toolCalls.length > 0) finishReason = "tool_calls";
  else if (textParts.length > 0) finishReason = "stop";

  const usage = response.usage
    ? {
        promptTokens: response.usage.inputTokens ?? 0,
        completionTokens: response.usage.outputTokens ?? 0,
        totalTokens: response.usage.totalTokens ?? 0,
      }
    : undefined;

  return {
    content: textParts.join("") || null,
    toolCalls,
    finishReason,
    usage,
  };
}
