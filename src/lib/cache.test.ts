import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The cache module uses process.cwd() for the root, so we test against the real output dir
import { cacheAppend, cacheReadAll, cacheReadLatest, cacheRemoveBefore, cacheCount, getCacheRoot } from "./cache.js";

const TEST_KEY = "__test_cache__";

function cleanup() {
  const file = join(getCacheRoot(), `${TEST_KEY}.ndjson`);
  if (existsSync(file)) rmSync(file);
}

describe("cache", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("appends entries and reads them back", () => {
    cacheAppend(TEST_KEY, { value: 1 });
    cacheAppend(TEST_KEY, { value: 2 });

    const all = cacheReadAll(TEST_KEY);
    expect(all).toHaveLength(2);
    expect(all[0].data).toEqual({ value: 1 });
    expect(all[1].data).toEqual({ value: 2 });
  });

  it("each entry has a timestamp", () => {
    cacheAppend(TEST_KEY, { x: true });
    const all = cacheReadAll(TEST_KEY);
    expect(all[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("readLatest returns the most recent entry", () => {
    cacheAppend(TEST_KEY, { first: true });
    cacheAppend(TEST_KEY, { second: true });

    const latest = cacheReadLatest(TEST_KEY);
    expect(latest?.data).toEqual({ second: true });
  });

  it("readLatest returns null for empty cache", () => {
    expect(cacheReadLatest(TEST_KEY)).toBeNull();
  });

  it("readAll returns empty array for missing key", () => {
    expect(cacheReadAll("__nonexistent__")).toEqual([]);
  });

  it("cacheCount returns correct count", () => {
    expect(cacheCount(TEST_KEY)).toBe(0);
    cacheAppend(TEST_KEY, { a: 1 });
    expect(cacheCount(TEST_KEY)).toBe(1);
    cacheAppend(TEST_KEY, { b: 2 });
    expect(cacheCount(TEST_KEY)).toBe(2);
  });

  it("removeBefore removes entries with earlier timestamps", () => {
    // Manually write entries with known timestamps
    const file = join(getCacheRoot(), `${TEST_KEY}.ndjson`);
    mkdirSync(getCacheRoot(), { recursive: true });
    const entries = [
      JSON.stringify({ timestamp: "2026-08-01T10:00", data: { old: true } }),
      JSON.stringify({ timestamp: "2026-08-10T10:00", data: { mid: true } }),
      JSON.stringify({ timestamp: "2026-08-14T10:00", data: { new: true } }),
    ];
    require("node:fs").writeFileSync(file, entries.join("\n") + "\n");

    const removed = cacheRemoveBefore(TEST_KEY, "2026-08-10T10:00");
    expect(removed).toBe(1);

    const remaining = cacheReadAll(TEST_KEY);
    expect(remaining).toHaveLength(2);
    expect(remaining[0].data).toEqual({ mid: true });
    expect(remaining[1].data).toEqual({ new: true });
  });

  it("removeBefore with future timestamp removes all", () => {
    cacheAppend(TEST_KEY, { a: 1 });
    cacheAppend(TEST_KEY, { b: 2 });

    const removed = cacheRemoveBefore(TEST_KEY, "2099-12-31T23:59");
    expect(removed).toBe(2);
    expect(cacheCount(TEST_KEY)).toBe(0);
  });

  it("removeBefore with past timestamp removes none", () => {
    cacheAppend(TEST_KEY, { a: 1 });

    const removed = cacheRemoveBefore(TEST_KEY, "2000-01-01T00:00");
    expect(removed).toBe(0);
    expect(cacheCount(TEST_KEY)).toBe(1);
  });
});
