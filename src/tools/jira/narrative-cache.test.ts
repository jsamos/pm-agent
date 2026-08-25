import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setCacheRoot } from "../../lib/cache.js";
import {
  computeThread,
  collectGroupIssueKeys,
  loadNarrativeCache,
  saveNarrativeCache,
  type NarrativeCacheEntry,
} from "./narrative-cache.js";
import type { IssueGroup } from "./group-issues.js";

const TEST_CACHE = join(process.cwd(), "output", "test-narrative-cache");

beforeEach(() => {
  setCacheRoot(TEST_CACHE);
  if (existsSync(TEST_CACHE)) rmSync(TEST_CACHE, { recursive: true });
  mkdirSync(TEST_CACHE, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_CACHE)) rmSync(TEST_CACHE, { recursive: true });
});

function makeEntry(overrides: Partial<NarrativeCacheEntry> = {}): NarrativeCacheEntry {
  return {
    thread: "abc123",
    groupBy: ["epic", "status"],
    sections: [
      {
        groupKey: "PROJ-1",
        groupLabel: "Alpha",
        issueKeys: ["X-1", "X-2"],
        prose: { groupKey: "PROJ-1", delivered: ["Alpha delivered."] },
        renderedMarkdown: "## Alpha\n\nAlpha delivered.",
      },
    ],
    ...overrides,
  };
}

// [tested] Scenario: computeThread produces consistent hash
describe("computeThread", () => {
  it("produces a consistent MD5 hash for the same JQL", () => {
    const jql = 'project = PROJ AND sprint in openSprints()';
    const hash1 = computeThread(jql);
    const hash2 = computeThread(jql);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(32);
  });

  it("produces different hashes for different JQL", () => {
    expect(computeThread("project = A")).not.toBe(computeThread("project = B"));
  });
});

// [tested] Scenario: collectGroupIssueKeys recursively collects from nested subGroups
describe("collectGroupIssueKeys", () => {
  it("collects keys from flat issues", () => {
    const group: IssueGroup = {
      groupKey: "test",
      groupLabel: "Test",
      issues: [
        { key: "X-1", summary: "", status: "", statusCategory: "", priority: "", assignee: null, issueType: "Story", description: null },
        { key: "X-2", summary: "", status: "", statusCategory: "", priority: "", assignee: null, issueType: "Story", description: null },
      ],
    };
    expect(collectGroupIssueKeys(group)).toEqual(["X-1", "X-2"]);
  });

  it("collects keys from nested subGroups", () => {
    const group: IssueGroup = {
      groupKey: "test",
      groupLabel: "Test",
      issues: [],
      subGroups: [
        {
          groupKey: "done",
          groupLabel: "Done",
          issues: [{ key: "X-1", summary: "", status: "", statusCategory: "", priority: "", assignee: null, issueType: "Story", description: null }],
          subGroups: [
            {
              groupKey: "PROJ-1",
              groupLabel: "Alpha",
              issues: [{ key: "X-2", summary: "", status: "", statusCategory: "", priority: "", assignee: null, issueType: "Story", description: null }],
            },
          ],
        },
      ],
    };
    expect(collectGroupIssueKeys(group).sort()).toEqual(["X-1", "X-2"]);
  });
});

// [tested] Scenario: loadNarrativeCache returns null when file doesn't exist
describe("loadNarrativeCache", () => {
  it("returns null when no cache file exists", () => {
    expect(loadNarrativeCache("nonexistent", ["epic", "status"])).toBeNull();
  });

  // [tested] Scenario: loadNarrativeCache returns most recent matching entry
  it("returns the most recent matching entry", () => {
    saveNarrativeCache(makeEntry({ thread: "abc", sections: [{ ...makeEntry().sections[0], groupLabel: "Old" }] }));
    saveNarrativeCache(makeEntry({ thread: "abc", sections: [{ ...makeEntry().sections[0], groupLabel: "New" }] }));

    const result = loadNarrativeCache("abc", ["epic", "status"]);
    expect(result).not.toBeNull();
    expect(result!.sections[0].groupLabel).toBe("New");
  });

  // [tested] Scenario: loadNarrativeCache ignores entries with different thread hash
  it("ignores entries with a different thread hash", () => {
    saveNarrativeCache(makeEntry({ thread: "other-thread" }));

    expect(loadNarrativeCache("abc", ["epic", "status"])).toBeNull();
  });

  // [tested] Scenario: GroupBy mismatch
  it("returns null when groupBy doesn't match", () => {
    saveNarrativeCache(makeEntry({ thread: "abc", groupBy: ["epic", "status"] }));

    expect(loadNarrativeCache("abc", ["assignee", "status", "epic"])).toBeNull();
  });

  // [tested] Scenario: GroupBy match
  it("returns entry when groupBy matches exactly", () => {
    saveNarrativeCache(makeEntry({ thread: "abc", groupBy: ["assignee", "status", "epic"] }));

    const result = loadNarrativeCache("abc", ["assignee", "status", "epic"]);
    expect(result).not.toBeNull();
    expect(result!.groupBy).toEqual(["assignee", "status", "epic"]);
  });
});

// [tested] Scenario: saveNarrativeCache appends to file
describe("saveNarrativeCache", () => {
  it("appends entries to the ndjson file", () => {
    saveNarrativeCache(makeEntry({ thread: "t1" }));
    saveNarrativeCache(makeEntry({ thread: "t2" }));

    const file = join(TEST_CACHE, "narrative_cache.ndjson");
    const lines = readFileSync(file, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).data.thread).toBe("t1");
    expect(JSON.parse(lines[1]).data.thread).toBe("t2");
  });
});

describe("removeNarrativeCacheForThread", () => {
  it("removes all entries for a thread", async () => {
    const { removeNarrativeCacheForThread } = await import("./narrative-cache.js");
    saveNarrativeCache(makeEntry({ thread: "keep" }));
    saveNarrativeCache(makeEntry({ thread: "drop" }));
    saveNarrativeCache(makeEntry({ thread: "drop", groupBy: ["assignee", "status", "epic"] }));

    expect(removeNarrativeCacheForThread("drop")).toBe(2);
    expect(loadNarrativeCache("drop", ["epic", "status"])).toBeNull();
    expect(loadNarrativeCache("keep", ["epic", "status"])).not.toBeNull();
  });
});
