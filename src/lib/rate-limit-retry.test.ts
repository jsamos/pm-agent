import { describe, it, expect, vi } from "vitest";
import {
  isRateLimitError,
  parseRetryAfterMs,
  withRateLimitRetry,
} from "./rate-limit-retry.js";

describe("isRateLimitError", () => {
  it("detects status 429", () => {
    expect(isRateLimitError({ status: 429, message: "Too Many Requests" })).toBe(true);
  });

  it("detects structured OpenAI error body", () => {
    expect(isRateLimitError({
      status: 429,
      code: "rate_limit_exceeded",
      type: "rate_limit_error",
      error: {
        message: "Rate limit reached for gpt-4o on tokens per min (TPM)",
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    })).toBe(true);
  });

  it("does not retry insufficient_quota", () => {
    expect(isRateLimitError({
      status: 429,
      code: "insufficient_quota",
      error: { code: "insufficient_quota", message: "You exceeded your current quota" },
    })).toBe(false);
  });

  it("returns false for other errors", () => {
    expect(isRateLimitError(new Error("401 Unauthorized"))).toBe(false);
  });
});

describe("parseRetryAfterMs", () => {
  it("prefers retry-after-ms header", () => {
    expect(parseRetryAfterMs({
      status: 429,
      headers: { "retry-after-ms": "5060" },
    })).toBe(5060);
  });

  it("parses Retry-After header in seconds", () => {
    expect(parseRetryAfterMs({ status: 429, headers: { "retry-after": "3" } })).toBe(3000);
  });

  it("reads retry-after-ms from Headers instance", () => {
    const headers = new Headers({ "retry-after-ms": "1200" });
    expect(parseRetryAfterMs({ status: 429, headers })).toBe(1200);
  });

  it("falls back to message hint when headers are absent", () => {
    const err = new Error("429 Rate limit reached. Please try again in 5.06s.");
    expect(parseRetryAfterMs(err)).toBe(5060);
  });

  it("returns null when no hint is present", () => {
    expect(parseRetryAfterMs(new Error("429 Rate limit reached"))).toBeNull();
  });
});

describe("withRateLimitRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRateLimitRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries using retry-after-ms header", async () => {
    const err = {
      status: 429,
      code: "rate_limit_exceeded",
      headers: { "retry-after-ms": "10" },
    };
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRateLimitRetry(fn, { maxRetries: 3, sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("rethrows after max retries", async () => {
    const err = { status: 429, headers: { "retry-after-ms": "10" } };
    const fn = vi.fn().mockRejectedValue(err);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRateLimitRetry(fn, { maxRetries: 2, sleep })).rejects.toEqual(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-rate-limit errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("500 Internal Server Error"));
    await expect(withRateLimitRetry(fn, { maxRetries: 3 })).rejects.toThrow("500");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
