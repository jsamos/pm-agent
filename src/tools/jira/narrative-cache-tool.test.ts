import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setCacheRoot, getCacheRoot } from "../../lib/cache.js";
import { computeThread } from "./narrative-cache.js";
import { jiraNarrativeCacheTool } from "./narrative-cache-tool.js";
import type { ExecutionContext } from "../../lib/context.js";

const TEST_CACHE = join(process.cwd(), "output", "test-narrative-cache-tool");

function makeContext(toolCallLog: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = []): ExecutionContext {
  return {
    toolCallLog,
    config: {},
    llm: {} as never,
    callTool: async () => ({}),
    listTools: async () => [],
    meta: { attempt: 1, workflowName: "test", stepName: "test" },
    runAgentLoop: async () => "",
  };
}

function seedEntries(entries: Array<{ timestamp: string; thread: string; groupBy: string[] }>) {
  mkdirSync(getCacheRoot(), { recursive: true });
  const lines = entries.map((e) => JSON.stringify({
    timestamp: e.timestamp,
    data: {
      thread: e.thread,
      groupBy: e.groupBy,
      sections: [{ groupKey: "PROJ-1", groupLabel: "Alpha", issueKeys: ["X-1"], prose: { groupKey: "PROJ-1" }, renderedMarkdown: "" }],
    },
  }));
  writeFileSync(join(getCacheRoot(), "narrative_cache.ndjson"), lines.join("\n") + "\n");
}

beforeEach(() => {
  setCacheRoot(TEST_CACHE);
  if (existsSync(TEST_CACHE)) rmSync(TEST_CACHE, { recursive: true });
  mkdirSync(TEST_CACHE, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_CACHE)) rmSync(TEST_CACHE, { recursive: true });
});

describe("jira_narrative_cache", () => {
  it("count returns zero when empty", async () => {
    const result = await jiraNarrativeCacheTool.execute({ action: "count" }, makeContext()) as { summary: string };
    expect(result.summary).toContain("0 narrative cache");
  });

  it("list shows cached entries", async () => {
    seedEntries([
      { timestamp: "2026-08-20T10:00", thread: "thread-a", groupBy: ["epic", "status"] },
      { timestamp: "2026-08-21T10:00", thread: "thread-b", groupBy: ["assignee", "status", "epic"] },
    ]);

    const result = await jiraNarrativeCacheTool.execute({ action: "list" }, makeContext()) as { summary: string };
    expect(result.summary).toContain("2 entries");
    expect(result.summary).toContain("epic → status");
  });

  it("clear removes all entries", async () => {
    seedEntries([{ timestamp: "2026-08-20T10:00", thread: "thread-a", groupBy: ["epic", "status"] }]);

    const result = await jiraNarrativeCacheTool.execute({ action: "clear" }, makeContext()) as { summary: string };
    expect(result.summary).toContain("removed 1");

    const count = await jiraNarrativeCacheTool.execute({ action: "count" }, makeContext()) as { summary: string };
    expect(count.summary).toContain("0 narrative cache");
  });

  it("remove_thread drops all entries for a thread", async () => {
    seedEntries([
      { timestamp: "2026-08-20T10:00", thread: "thread-a", groupBy: ["epic", "status"] },
      { timestamp: "2026-08-20T11:00", thread: "thread-a", groupBy: ["assignee", "status", "epic"] },
      { timestamp: "2026-08-20T12:00", thread: "thread-b", groupBy: ["epic", "status"] },
    ]);

    const result = await jiraNarrativeCacheTool.execute(
      { action: "remove_thread", thread: "thread-a" },
      makeContext(),
    ) as { summary: string };

    expect(result.summary).toContain("Removed 2");
    expect(result.summary).toContain("1 remaining");
  });

  it("remove_thread derives thread from last search_jira_issues", async () => {
    const jql = "project = PROJ AND sprint in openSprints()";
    const thread = computeThread(jql);
    seedEntries([
      { timestamp: "2026-08-20T10:00", thread, groupBy: ["epic", "status"] },
      { timestamp: "2026-08-20T11:00", thread: "other", groupBy: ["epic", "status"] },
    ]);

    const ctx = makeContext([
      { tool: "search_jira_issues", args: { jql }, result: { jql, issues: [] } },
    ]);

    const result = await jiraNarrativeCacheTool.execute({ action: "remove_thread" }, ctx) as { summary: string };
    expect(result.summary).toContain("Removed 1");
    expect(result.summary).toContain("1 remaining");
  });

  it("remove drops only matching thread and groupBy", async () => {
    const thread = "thread-a";
    seedEntries([
      { timestamp: "2026-08-20T10:00", thread, groupBy: ["epic", "status"] },
      { timestamp: "2026-08-20T11:00", thread, groupBy: ["assignee", "status", "epic"] },
    ]);

    const ctx = makeContext([
      { tool: "search_jira_issues", args: {}, result: { jql: "project = A", issues: [] } },
      { tool: "group_issues", args: {}, result: { groupBy: ["epic", "status"], groups: [] } },
    ]);
    // Override: search jql doesn't match thread-a — pass thread explicitly
    const result = await jiraNarrativeCacheTool.execute(
      { action: "remove", thread },
      ctx,
    ) as { summary: string };

    expect(result.summary).toContain("Removed 1");
    expect(result.summary).toContain("1 remaining");
  });

  it("compact keeps latest entry per thread and groupBy", async () => {
    seedEntries([
      { timestamp: "2026-08-19T10:00", thread: "thread-a", groupBy: ["epic", "status"] },
      { timestamp: "2026-08-20T10:00", thread: "thread-a", groupBy: ["epic", "status"] },
      { timestamp: "2026-08-20T11:00", thread: "thread-a", groupBy: ["assignee", "status", "epic"] },
    ]);

    const result = await jiraNarrativeCacheTool.execute({ action: "compact" }, makeContext()) as { summary: string };
    expect(result.summary).toContain("removed 1");
    expect(result.summary).toContain("2 remaining");
  });
});
