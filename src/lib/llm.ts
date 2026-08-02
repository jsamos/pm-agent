/**
 * Provider-agnostic LLM interface with tool-use support.
 * Agents interact with this interface — they never import provider SDKs directly.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "unknown";
}

export interface LLM {
  generate(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;
  generateWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: LLMOptions
  ): Promise<LLMResponse>;
}

export interface LLMProvider {
  create(config?: Record<string, unknown>): LLM;
}
