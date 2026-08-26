import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenBucket } from "./token-bucket.js";

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
});
