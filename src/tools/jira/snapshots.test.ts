import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { jiraSearchSnapshotsTool } from "./snapshots.js";
import { getCacheRoot, setCacheRoot } from "../../lib/cache.js";
import type { ExecutionContext } from "../../lib/context.js";

let originalRoot: string;
let testRoot: string;

beforeAll(() => {
  originalRoot = getCacheRoot();
  testRoot = mkdtempSync(join(tmpdir(), "snapshot-test-"));
  setCacheRoot(testRoot);
});

afterAll(() => {
  setCacheRoot(originalRoot);
  if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
});

const CACHE_FILE = () => join(getCacheRoot(), "jira_snapshots.ndjson");

function makeContext(toolCallLog: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>): ExecutionContext {
  return { toolCallLog, config: {}, llm: {} as never, callTool: async () => ({}), listTools: async () => [], meta: { attempt: 1, workflowName: "test", stepName: "test" }, runAgentLoop: async () => "" };
}

function makeSearchResult(issues: Array<{ key: string; statusCategory?: string }>, jql = "test JQL") {
  return { tool: "search_jira_issues", args: { jql }, result: { issues, jql } };
}

function seedCache(entries: Array<{ thread: string; jql: string; issues: Array<{ key: string; statusCategory?: string }> }>) {
  mkdirSync(getCacheRoot(), { recursive: true });
  const lines = entries.map((e) => JSON.stringify({ timestamp: "2026-08-14T09:00", data: e }));
  writeFileSync(CACHE_FILE(), lines.join("\n") + "\n");
}

function cleanup() {
  const f = CACHE_FILE();
  if (existsSync(f)) rmSync(f);
}

describe("jira_search_snapshots: diff action", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("returns 'no baseline' when no cached snapshot exists for the thread", async () => {
    const ctx = makeContext([makeSearchResult([{ key: "X-1", statusCategory: "To Do" }])]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "diff" }, ctx) as { changed: boolean; summary: string; baselineTimestamp: string | null };

    expect(result.changed).toBe(true);
    expect(result.baselineTimestamp).toBeNull();
    expect(result.summary).toContain("No baseline");
    expect(result.summary).toContain("first run");
  });

  it("returns unchanged when issues are identical", async () => {
    const { createHash } = await import("node:crypto");
    const jql = "parent in (PROJ-914)";
    const thread = createHash("md5").update(jql).digest("hex");

    seedCache([{ thread, jql, issues: [{ key: "X-1", statusCategory: "In Progress" }, { key: "X-2", statusCategory: "Done" }] }]);

    const ctx = makeContext([makeSearchResult([{ key: "X-1", statusCategory: "In Progress" }, { key: "X-2", statusCategory: "Done" }], jql)]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "diff" }, ctx) as { changed: boolean; summary: string };

    expect(result.changed).toBe(false);
    expect(result.summary).toContain("No changes since");
  });

  it("detects added issues", async () => {
    const { createHash } = await import("node:crypto");
    const jql = "parent in (PROJ-914)";
    const thread = createHash("md5").update(jql).digest("hex");

    seedCache([{ thread, jql, issues: [{ key: "X-1", statusCategory: "To Do" }] }]);

    const ctx = makeContext([makeSearchResult([{ key: "X-1", statusCategory: "To Do" }, { key: "X-2", statusCategory: "In Progress" }], jql)]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "diff" }, ctx) as { changed: boolean; added: string[]; summary: string };

    expect(result.changed).toBe(true);
    expect(result.added).toEqual(["X-2"]);
    expect(result.summary).toContain("1 added");
  });

  it("detects removed issues", async () => {
    const { createHash } = await import("node:crypto");
    const jql = "parent in (PROJ-914)";
    const thread = createHash("md5").update(jql).digest("hex");

    seedCache([{ thread, jql, issues: [{ key: "X-1", statusCategory: "To Do" }, { key: "X-2", statusCategory: "Done" }] }]);

    const ctx = makeContext([makeSearchResult([{ key: "X-1", statusCategory: "To Do" }], jql)]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "diff" }, ctx) as { changed: boolean; removed: string[]; summary: string };

    expect(result.changed).toBe(true);
    expect(result.removed).toEqual(["X-2"]);
    expect(result.summary).toContain("1 removed");
  });

  it("detects status category changes", async () => {
    const { createHash } = await import("node:crypto");
    const jql = "parent in (PROJ-914)";
    const thread = createHash("md5").update(jql).digest("hex");

    seedCache([{ thread, jql, issues: [{ key: "X-1", statusCategory: "To Do" }, { key: "X-2", statusCategory: "In Progress" }] }]);

    const ctx = makeContext([makeSearchResult([{ key: "X-1", statusCategory: "In Progress" }, { key: "X-2", statusCategory: "Done" }], jql)]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "diff" }, ctx) as { changed: boolean; statusChanges: Array<{ key: string; was: string; now: string }>; summary: string };

    expect(result.changed).toBe(true);
    expect(result.statusChanges).toHaveLength(2);
    expect(result.statusChanges[0]).toEqual({ key: "X-1", was: "To Do", now: "In Progress" });
    expect(result.statusChanges[1]).toEqual({ key: "X-2", was: "In Progress", now: "Done" });
    expect(result.summary).toContain("2 status changes");
  });

  it("ignores description and priority changes (not meaningful for diff)", async () => {
    const { createHash } = await import("node:crypto");
    const jql = "parent in (PROJ-914)";
    const thread = createHash("md5").update(jql).digest("hex");

    seedCache([{ thread, jql, issues: [{ key: "X-1", statusCategory: "To Do", description: "old", priority: "Low" } as never] }]);

    const ctx = makeContext([makeSearchResult([{ key: "X-1", statusCategory: "To Do", description: "new description", priority: "High" } as never], jql)]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "diff" }, ctx) as { changed: boolean };

    expect(result.changed).toBe(false);
  });

  it("uses the most recent snapshot for the thread as baseline", async () => {
    const { createHash } = await import("node:crypto");
    const jql = "parent in (PROJ-914)";
    const thread = createHash("md5").update(jql).digest("hex");

    mkdirSync(getCacheRoot(), { recursive: true });
    const lines = [
      JSON.stringify({ timestamp: "2026-08-13T09:00", data: { thread, jql, issues: [{ key: "X-1", statusCategory: "To Do" }] } }),
      JSON.stringify({ timestamp: "2026-08-14T09:00", data: { thread, jql, issues: [{ key: "X-1", statusCategory: "In Progress" }] } }),
    ];
    writeFileSync(CACHE_FILE(), lines.join("\n") + "\n");

    // Fresh result matches the newer baseline (In Progress)
    const ctx = makeContext([makeSearchResult([{ key: "X-1", statusCategory: "In Progress" }], jql)]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "diff" }, ctx) as { changed: boolean; baselineTimestamp: string };

    expect(result.changed).toBe(false);
    expect(result.baselineTimestamp).toBe("2026-08-14T09:00");
  });

  it("throws when no toolCallLog is available", async () => {
    const ctx = makeContext([]);
    await expect(jiraSearchSnapshotsTool.execute({ action: "diff" }, ctx)).rejects.toThrow("No tool call log");
  });
});

describe("jira_search_snapshots: save → diff round-trip", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("diff finds baseline after a save with the same JQL", async () => {
    const jql = 'project in (WORK) AND sprint in openSprints() AND assignee in ("abc123") ORDER BY status ASC';
    const issues = [{ key: "X-1", statusCategory: "In Progress" }, { key: "X-2", statusCategory: "Done" }];

    // Run 1: save
    const saveCtx = makeContext([makeSearchResult(issues, jql)]);
    await jiraSearchSnapshotsTool.execute({ action: "save" }, saveCtx);

    // Run 2: diff with same data
    const diffCtx = makeContext([makeSearchResult(issues, jql)]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "diff" }, diffCtx) as { changed: boolean; summary: string };

    expect(result.changed).toBe(false);
    expect(result.summary).toContain("No changes since");
  });

  it("diff detects changes after save when status changes", async () => {
    const jql = "project = TEST ORDER BY status ASC";
    const issuesV1 = [{ key: "X-1", statusCategory: "To Do" }];
    const issuesV2 = [{ key: "X-1", statusCategory: "Done" }];

    // Run 1: save
    const saveCtx = makeContext([makeSearchResult(issuesV1, jql)]);
    await jiraSearchSnapshotsTool.execute({ action: "save" }, saveCtx);

    // Run 2: diff with changed data
    const diffCtx = makeContext([makeSearchResult(issuesV2, jql)]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "diff" }, diffCtx) as {
      changed: boolean;
      statusChanges: Array<{ key: string; was: string; now: string }>;
    };

    expect(result.changed).toBe(true);
    expect(result.statusChanges).toEqual([{ key: "X-1", was: "To Do", now: "Done" }]);
  });

  it("diff reports first run when no prior save exists", async () => {
    const jql = "project = TEST";
    const issues = [{ key: "X-1", statusCategory: "To Do" }];

    const ctx = makeContext([makeSearchResult(issues, jql)]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "diff" }, ctx) as {
      changed: boolean;
      baselineTimestamp: string | null;
      summary: string;
    };

    expect(result.changed).toBe(true);
    expect(result.baselineTimestamp).toBeNull();
    expect(result.summary).toContain("first run");
  });

  it("back-to-back: save, save, diff finds the latest save", async () => {
    const jql = "project = TEST ORDER BY status ASC";
    const issuesV1 = [{ key: "X-1", statusCategory: "To Do" }];
    const issuesV2 = [{ key: "X-1", statusCategory: "In Progress" }];

    // Save v1
    const save1 = makeContext([makeSearchResult(issuesV1, jql)]);
    await jiraSearchSnapshotsTool.execute({ action: "save" }, save1);

    // Save v2
    const save2 = makeContext([makeSearchResult(issuesV2, jql)]);
    await jiraSearchSnapshotsTool.execute({ action: "save" }, save2);

    // Diff with v2 — should find v2 baseline (unchanged)
    const diffCtx = makeContext([makeSearchResult(issuesV2, jql)]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "diff" }, diffCtx) as { changed: boolean };

    expect(result.changed).toBe(false);
  });
});

describe("jira_search_snapshots: compact action", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("keeps only the latest snapshot per thread", async () => {
    const { createHash } = await import("node:crypto");
    const jql1 = "project = A";
    const jql2 = "project = B";
    const thread1 = createHash("md5").update(jql1).digest("hex");
    const thread2 = createHash("md5").update(jql2).digest("hex");

    mkdirSync(getCacheRoot(), { recursive: true });
    const lines = [
      JSON.stringify({ timestamp: "2026-08-13T09:00", data: { thread: thread1, jql: jql1, issues: [{ key: "X-1" }] } }),
      JSON.stringify({ timestamp: "2026-08-14T09:00", data: { thread: thread1, jql: jql1, issues: [{ key: "X-1" }, { key: "X-2" }] } }),
      JSON.stringify({ timestamp: "2026-08-13T10:00", data: { thread: thread2, jql: jql2, issues: [{ key: "Y-1" }] } }),
      JSON.stringify({ timestamp: "2026-08-14T10:00", data: { thread: thread2, jql: jql2, issues: [{ key: "Y-1" }, { key: "Y-2" }] } }),
    ];
    writeFileSync(CACHE_FILE(), lines.join("\n") + "\n");

    const ctx = makeContext([]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "compact" }, ctx) as { summary: string };

    expect(result.summary).toContain("removed 2");
    expect(result.summary).toContain("2 thread(s) remaining");
  });

  it("does nothing when each thread has only one snapshot", async () => {
    const { createHash } = await import("node:crypto");
    const jql = "project = A";
    const thread = createHash("md5").update(jql).digest("hex");

    seedCache([{ thread, jql, issues: [{ key: "X-1" }] }]);

    const ctx = makeContext([]);
    const result = await jiraSearchSnapshotsTool.execute({ action: "compact" }, ctx) as { summary: string };

    expect(result.summary).toContain("removed 0");
    expect(result.summary).toContain("1 thread(s) remaining");
  });
});
