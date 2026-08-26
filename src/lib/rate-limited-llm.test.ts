import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimitedLLM } from "./rate-limited-llm.js";
import { TokenBucket } from "./token-bucket.js";
import type { LLM, LLMResponse } from "./llm.js";

function mockResponse(totalTokens: number): LLMResponse {
  return {
    content: "ok",
    toolCalls: [],
    finishReason: "stop",
    usage: { promptTokens: 100, completionTokens: totalTokens - 100, totalTokens },
  };
}

describe("createRateLimitedLLM", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records usage from the inner LLM response", async () => {
    const bucket = new TokenBucket({ limit: 30_000 });
    const inner: LLM = {
      generate: vi.fn(async () => mockResponse(1200)),
      generateWithTools: vi.fn(async () => mockResponse(1200)),
    };

    const llm = createRateLimitedLLM(inner, bucket, 3000);
    const pending = llm.generate([{ role: "user", content: "hi" }]);
    await vi.runAllTimersAsync();
    await pending;

    expect(bucket.usedTokens()).toBe(1200);
  });

  it("waits when TPM budget is exhausted", async () => {
    const bucket = new TokenBucket({ limit: 5000 });
    const inner: LLM = {
      generate: vi.fn(async () => mockResponse(4000)),
      generateWithTools: vi.fn(async () => mockResponse(4000)),
    };
    const llm = createRateLimitedLLM(inner, bucket, 3000);

    const first = llm.generate([{ role: "user", content: "a" }]);
    await vi.runAllTimersAsync();
    await first;

    const second = llm.generate([{ role: "user", content: "b" }]);
    await vi.runAllTimersAsync();
    await second;

    expect(inner.generate).toHaveBeenCalledTimes(2);
    expect(bucket.usedTokens()).toBe(4000);
  });
});
