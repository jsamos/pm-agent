import "dotenv/config";
import OpenAI from "openai";
import type {
  LLM,
  LLMOptions,
  LLMResponse,
  LLMProvider,
  Message,
  ToolCall,
  ToolDefinition,
} from "../llm.js";
import { withRateLimitRetry } from "../rate-limit-retry.js";

const DEFAULT_MODEL = "gpt-4o";

function toOpenAIMessages(
  messages: Message[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      return {
        role: "tool" as const,
        content: msg.content,
        tool_call_id: msg.toolCallId!,
      };
    }
    if (msg.role === "assistant" && msg.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: msg.content,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      };
    }
    return {
      role: msg.role as "system" | "user" | "assistant",
      content: msg.content,
    };
  });
}

function toOpenAITools(
  tools: ToolDefinition[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseResetMs(raw: string | null): number | null {
  if (!raw) return null;
  if (raw.endsWith("ms")) {
    const ms = parseFloat(raw);
    return Number.isNaN(ms) ? null : ms;
  }
  if (raw.endsWith("s")) {
    const seconds = parseFloat(raw.slice(0, -1));
    return Number.isNaN(seconds) ? null : seconds * 1000;
  }
  const seconds = parseFloat(raw);
  return Number.isNaN(seconds) ? null : seconds * 1000;
}

export function parseCompletionResponse(
  completion: OpenAI.Chat.Completions.ChatCompletion,
  headers?: Headers,
): LLMResponse {
  const choice = completion.choices[0];
  const message = choice.message;
  const toolCalls: ToolCall[] = (message.tool_calls || [])
    .filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => tc.type === "function")
    .map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

  let finishReason: LLMResponse["finishReason"];
  switch (choice.finish_reason) {
    case "stop":
      finishReason = "stop";
      break;
    case "tool_calls":
      finishReason = "tool_calls";
      break;
    case "length":
      finishReason = "length";
      break;
    default:
      finishReason = "unknown";
  }

  const usage = completion.usage
    ? {
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
      }
    : undefined;

  const remainingRaw = headers?.get("x-ratelimit-remaining-tokens");
  const remainingTokens = remainingRaw != null ? parseFloat(remainingRaw) : null;

  return {
    content: message.content,
    toolCalls,
    finishReason,
    usage,
    rateLimit: headers
      ? {
          remainingTokens: remainingTokens != null && !Number.isNaN(remainingTokens)
            ? remainingTokens
            : null,
          resetMs: parseResetMs(headers.get("x-ratelimit-reset-tokens")),
        }
      : undefined,
  };
}

class OpenAILLM implements LLM {
  private client: OpenAI;
  private defaultModel: string;

  constructor(apiKey: string, model?: string) {
    const maxRetries = Number(process.env.LLM_MAX_RETRIES ?? 5);
    this.client = new OpenAI({ apiKey, maxRetries });
    this.defaultModel = model || DEFAULT_MODEL;
  }

  async generate(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    const model = options?.model || this.defaultModel;
    return withRateLimitRetry(
      () => this.generateOnce(messages, options),
      { label: model },
    );
  }

  async generateWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const model = options?.model || this.defaultModel;
    return withRateLimitRetry(
      () => this.generateWithToolsOnce(messages, tools, options),
      { label: model },
    );
  }

  private async generateOnce(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    const model = options?.model || this.defaultModel;
    const { data: completion, response } = await this.client.chat.completions
      .create({
        model,
        messages: toOpenAIMessages(messages),
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      })
      .withResponse();
    return parseCompletionResponse(completion, response.headers);
  }

  private async generateWithToolsOnce(
    messages: Message[],
    tools: ToolDefinition[],
    options?: LLMOptions,
  ): Promise<LLMResponse> {
    const model = options?.model || this.defaultModel;
    const { data: completion, response } = await this.client.chat.completions
      .create({
        model,
        messages: toOpenAIMessages(messages),
        tools: toOpenAITools(tools),
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      })
      .withResponse();
    return parseCompletionResponse(completion, response.headers);
  }
}

export const openaiProvider: LLMProvider = {
  create(config?: Record<string, unknown>): LLM {
    const apiKey = (config?.apiKey as string) || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OpenAI API key not found. Set OPENAI_API_KEY env var or pass apiKey in config."
      );
    }
    const model = config?.model as string | undefined;
    return new OpenAILLM(apiKey, model);
  },
};
