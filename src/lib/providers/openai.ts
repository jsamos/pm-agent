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

function parseResponse(
  choice: OpenAI.Chat.Completions.ChatCompletion.Choice
): LLMResponse {
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

  return {
    content: message.content,
    toolCalls,
    finishReason,
  };
}

class OpenAILLM implements LLM {
  private client: OpenAI;
  private defaultModel: string;

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({ apiKey });
    this.defaultModel = model || DEFAULT_MODEL;
  }

  async generate(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    const completion = await this.client.chat.completions.create({
      model: options?.model || this.defaultModel,
      messages: toOpenAIMessages(messages),
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
    });

    return parseResponse(completion.choices[0]);
  }

  async generateWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const completion = await this.client.chat.completions.create({
      model: options?.model || this.defaultModel,
      messages: toOpenAIMessages(messages),
      tools: toOpenAITools(tools),
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
    });

    return parseResponse(completion.choices[0]);
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
