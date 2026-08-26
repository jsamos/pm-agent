import { describe, it, expect } from "vitest";
import { parseCompletionResponse } from "./openai.js";

describe("parseCompletionResponse", () => {
  it("includes usage when present on the completion", () => {
    const completion = {
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: "hello", tool_calls: [] },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    } as never;

    const response = parseCompletionResponse(completion);
    expect(response.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("parses rate limit headers when provided", () => {
    const completion = {
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: "hello", tool_calls: [] },
      }],
    } as never;

    const headers = new Headers({
      "x-ratelimit-remaining-tokens": "12000",
      "x-ratelimit-reset-tokens": "6s",
    });

    const response = parseCompletionResponse(completion, headers);
    expect(response.rateLimit).toEqual({
      remainingTokens: 12000,
      resetMs: 6000,
    });
  });
});
