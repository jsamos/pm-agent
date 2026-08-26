import type { LLM, LLMOptions, LLMResponse, Message, ToolDefinition } from "./llm.js";
import type { TokenBucket } from "./token-bucket.js";

export function createRateLimitedLLM(
  inner: LLM,
  bucket: TokenBucket,
  estimate: number,
): LLM {
  async function run<T extends LLMResponse>(
    fn: () => Promise<T>,
  ): Promise<T> {
    await bucket.acquire(estimate);
    const response = await fn();
    const actual = response.usage?.totalTokens ?? estimate;
    bucket.record(actual, estimate);
    if (response.rateLimit?.remainingTokens != null) {
      bucket.syncFromHeaders(response.rateLimit.remainingTokens);
    }
    return response;
  }

  return {
    generate(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
      return run(() => inner.generate(messages, options));
    },

    generateWithTools(
      messages: Message[],
      tools: ToolDefinition[],
      options?: LLMOptions,
    ): Promise<LLMResponse> {
      return run(() => inner.generateWithTools(messages, tools, options));
    },
  };
}
