import type { LLM, LLMOptions, LLMResponse, LLMProvider, Message, ToolDefinition } from "../llm.js";
import { loadBedrockConfig, resolveBedrockInferenceArn } from "../bedrock-models.js";
import { bedrockConverse, parseConverseResponse } from "../bedrock-converse.js";

class BedrockLLM implements LLM {
  async generate(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    return this.invoke(messages, [], options);
  }

  async generateWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: LLMOptions,
  ): Promise<LLMResponse> {
    return this.invoke(messages, tools, options);
  }

  private async invoke(
    messages: Message[],
    tools: ToolDefinition[],
    options?: LLMOptions,
  ): Promise<LLMResponse> {
    const profile = process.env.AWS_PROFILE;
    if (!profile) {
      throw new Error("Missing AWS_PROFILE for Bedrock LLM calls.");
    }

    const bedrockConfig = loadBedrockConfig();
    const region = process.env.AWS_REGION ?? bedrockConfig.region ?? "us-east-1";
    const modelKey = options?.model;
    if (!modelKey?.trim()) {
      throw new Error("Bedrock provider requires modelId (bedrock.json key) in options.model.");
    }

    const modelId = resolveBedrockInferenceArn({
      config: bedrockConfig,
      modelKey: modelKey.trim(),
    });

    const response = await bedrockConverse({
      modelId,
      messages,
      tools: tools.length ? tools : undefined,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
      profile,
      region,
    });

    const parsed = parseConverseResponse(response);
    return {
      content: parsed.content,
      toolCalls: parsed.toolCalls,
      finishReason: parsed.finishReason,
      usage: parsed.usage,
    };
  }
}

export const bedrockProvider: LLMProvider = {
  create(): LLM {
    return new BedrockLLM();
  },
};
