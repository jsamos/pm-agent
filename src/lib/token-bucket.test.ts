import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenBucket, tokenEstimate, tpmLimitFromEnv } from "./token-bucket.js";

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("acquire proceeds immediately when under limit", async () => {
    const bucket = new TokenBucket({ limit: 10_000 });
    const pending = bucket.acquire(3000);
    await vi.runAllTimersAsync();
    await pending;
    expect(bucket.usedTokens()).toBe(3000);
  });

  it("record adjusts reservation to actual usage", async () => {
    const bucket = new TokenBucket({ limit: 10_000 });
    const pending = bucket.acquire(3000);
    await vi.runAllTimersAsync();
    await pending;
    bucket.record(1500, 3000);
    expect(bucket.usedTokens()).toBe(1500);
  });

  it("waits when the window is full then acquires after entries expire", async () => {
    const bucket = new TokenBucket({ limit: 5000, windowMs: 60_000 });

    const first = bucket.acquire(4000);
    await vi.runAllTimersAsync();
    await first;

    const second = bucket.acquire(3000);
    await vi.runAllTimersAsync();
    await second;

    expect(bucket.usedTokens()).toBe(3000);
  });

  it("drops entries outside the rolling window", async () => {
    const bucket = new TokenBucket({ limit: 10_000 });
    const pending = bucket.acquire(8000);
    await vi.runAllTimersAsync();
    await pending;

    vi.advanceTimersByTime(61_000);
    expect(bucket.usedTokens()).toBe(0);
  });

  it("syncFromHeaders increases used when provider reports higher consumption", async () => {
    const bucket = new TokenBucket({ limit: 30_000 });
    const pending = bucket.acquire(1000);
    await vi.runAllTimersAsync();
    await pending;

    bucket.syncFromHeaders(5000);
    expect(bucket.usedTokens()).toBe(25_000);
  });

  it("writes a wait message to stderr when the window is full", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const bucket = new TokenBucket({ limit: 5000, windowMs: 60_000 });

    const first = bucket.acquire(4000);
    await vi.runAllTimersAsync();
    await first;

    const second = bucket.acquire(3000);
    await vi.runAllTimersAsync();
    await second;

    expect(stderrSpy).toHaveBeenCalled();
    expect(String(stderrSpy.mock.calls[0][0])).toContain("TPM wait");
    stderrSpy.mockRestore();
  });
});

describe("tokenEstimate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 3000 when unset", () => {
    delete process.env.LLM_TOKEN_ESTIMATE;
    expect(tokenEstimate()).toBe(3000);
  });

  it("uses LLM_TOKEN_ESTIMATE when set", () => {
    vi.stubEnv("LLM_TOKEN_ESTIMATE", "5000");
    expect(tokenEstimate()).toBe(5000);
  });
});

describe("tpmLimitFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when OPENAI_TPM_LIMIT is unset", () => {
    delete process.env.OPENAI_TPM_LIMIT;
    expect(tpmLimitFromEnv()).toBeNull();
  });

  it("returns the configured limit", () => {
    vi.stubEnv("OPENAI_TPM_LIMIT", "30000");
    expect(tpmLimitFromEnv()).toBe(30_000);
  });
});
