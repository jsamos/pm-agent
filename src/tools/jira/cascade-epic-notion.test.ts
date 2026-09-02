import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cascadeEpicNotionUpdatesTool } from "./cascade-epic-notion.js";
import { buildEpicJqlTool } from "./build-epic-jql.js";
import { searchIssuesTool } from "./search-issues.js";
import { jiraSearchSnapshotsTool } from "./snapshots.js";
import { groupIssuesTool } from "./group-issues.js";
import { generateEpicNarrativeTool } from "./generate-epic-narrative.js";
import { updateNotionPageTool } from "../notion/update-page.js";
import { getCacheRoot, setCacheRoot } from "../../lib/cache.js";
import type { ExecutionContext } from "../../lib/context.js";
import type { JiraIssue } from "./search-issues.js";
import type { RosterEntry } from "../roster/types.js";

const ALICE_ID = "712020:00000000-0000-0000-0000-000000000001";
const UNKNOWN_ID = "712020:00000000-0000-0000-0000-000000009999";
const WORK_PAGE = "https://www.notion.so/workspace/Alice-Work-a1b2c3d4e5f67890abcdef1234567890";

vi.mock("./client.js", () => ({
  callJiraTool: vi.fn(),
  extractTextContent: vi.fn((result: { content: { text: string }[] }) => JSON.parse(result.content[0].text)),
}));

vi.mock("../notion/client.js", () => ({
  callNotionTool: vi.fn(async () => ({
    content: [{ type: "text", text: "OK" }],
    isError: false,
  })),
  extractTextContent: vi.fn((result: { content: { text: string }[] }) => result.content[0].text),
}));

vi.mock("../../lib/agent-loop.js", () => ({
  trace: vi.fn(),
}));

const rosterEntry: RosterEntry = {
  name: "Alice Martin",
  shortName: "Alice",
  accountId: ALICE_ID,
  displayName: "Alice Martin",
  workPages: [{ page: WORK_PAGE, epics: ["PROJ-100"] }],
};

vi.mock("../roster/read.js", () => ({
  loadRosterFile: vi.fn(() => ({ resolved: [rosterEntry], unresolved: [], generatedAt: "" })),
}));

import { callJiraTool } from "./client.js";
import { callNotionTool } from "../notion/client.js";
import { loadRosterFile } from "../roster/read.js";

let originalCacheRoot: string;
let testCacheRoot: string;

function makeIssue(key: string, overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key,
    summary: `Summary ${key}`,
    status: "In Progress",
    statusCategory: "In Progress",
    statusCategoryChangedDate: null,
    priority: "Medium",
    assignee: "Alice Martin",
    assigneeAccountId: ALICE_ID,
    parent: { key: "PROJ-100", summary: "Epic Alpha", issueType: "Epic" },
    issueType: key.startsWith("PROJ-") ? "Epic" : "Story",
    description: null,
    sprint: null,
    ...overrides,
  };
}

function sprintLog(overrides: {
  diffChanged?: boolean;
  baselineTimestamp?: string | null;
  added?: string[];
  sprintIssues?: JiraIssue[];
} = {}) {
  const sprintIssues = overrides.sprintIssues ?? [makeIssue("X-1")];
  const jql = "project = TEST AND sprint in openSprints()";
  return [
    {
      tool: "search_jira_issues",
      args: { jql, resolveParentsTo: "Epic" },
      result: { issues: sprintIssues, jql, total: sprintIssues.length },
    },
    {
      tool: "jira_search_snapshots",
      args: { action: "diff" },
      result: {
        changed: overrides.diffChanged ?? true,
        added: overrides.added ?? ["X-1"],
        removed: [],
        statusChanges: [],
        parentChanges: [],
        assigneeChanges: [],
        baselineTimestamp: overrides.baselineTimestamp ?? "2026-08-17T10:00",
        summary: "Changed",
      },
    },
    {
      tool: "jira_search_snapshots",
      args: { action: "save" },
      result: { summary: "Saved" },
    },
    {
      tool: "generate_sprint_narrative",
      args: {},
      result: { narrative: "Sprint narrative", summary: "done" },
    },
  ];
}

function mockContext(log: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>): ExecutionContext {
  return {
    toolCallLog: log,
    config: {
      cloudId: "cloud-1",
      issueLinkBase: "https://example.atlassian.net/browse",
    },
    llm: {
      generate: vi.fn(async () => ({
        content: "## Outcome\n\nEpic progress summary with X-1 cited.",
        toolCalls: [],
        finishReason: "stop" as const,
      })),
      generateWithTools: vi.fn(),
    },
    callTool: async () => ({}),
    listTools: async () => [],
    meta: { attempt: 1, workflowName: "test", stepName: "test" },
    runAgentLoop: async () => "",
  } as unknown as ExecutionContext;
}

function rawJiraIssue(
  key: string,
  overrides: {
    issueType?: string;
    parent?: { key: string; summary: string; issueType: string } | null;
    assigneeAccountId?: string | null;
  } = {},
) {
  return {
    key,
    fields: {
      summary: `Summary ${key}`,
      status: { name: "In Progress", statusCategory: { name: "In Progress" } },
      priority: { name: "Medium" },
      assignee: overrides.assigneeAccountId === null
        ? null
        : { displayName: "Alice Martin", accountId: overrides.assigneeAccountId ?? ALICE_ID },
      issuetype: { name: overrides.issueType ?? "Story" },
      parent: overrides.parent === null
        ? null
        : overrides.parent
          ? {
              key: overrides.parent.key,
              fields: {
                summary: overrides.parent.summary,
                issuetype: { name: overrides.parent.issueType },
              },
            }
          : { key: "PROJ-100", fields: { summary: "Epic Alpha", issuetype: { name: "Epic" } } },
      description: null,
      statuscategorychangedate: null,
    },
  };
}

function mockEpicSearchIssues(
  childCount = 1,
  epicKey = "PROJ-100",
) {
  const epic = rawJiraIssue(epicKey, { issueType: "Epic", parent: null });
  const children = Array.from({ length: childCount }, (_, i) =>
    rawJiraIssue(`X-${i + 1}`, { issueType: "Story", parent: { key: epicKey, summary: "Epic", issueType: "Epic" } }),
  );
  vi.mocked(callJiraTool).mockResolvedValueOnce({
    isError: false,
    content: [{ type: "text", text: JSON.stringify({ issues: childCount > 0 ? [epic, ...children] : [epic] }) }],
  });
}

function wrapExecute<T extends { execute: (...args: never[]) => unknown }>(
  tool: T,
  name: string,
  order: string[],
): ReturnType<typeof vi.spyOn> {
  const original = tool.execute.bind(tool);
  return vi.spyOn(tool, "execute").mockImplementation(async (...args: Parameters<T["execute"]>) => {
    order.push(name);
    return original(...args) as ReturnType<T["execute"]>;
  });
}

beforeAll(() => {
  originalCacheRoot = getCacheRoot();
  testCacheRoot = mkdtempSync(join(tmpdir(), "cascade-test-"));
  setCacheRoot(testCacheRoot);
});

afterAll(() => {
  setCacheRoot(originalCacheRoot);
  if (existsSync(testCacheRoot)) rmSync(testCacheRoot, { recursive: true });
});

beforeEach(() => {
  vi.mocked(callJiraTool).mockReset();
  vi.mocked(callNotionTool).mockClear();
  vi.mocked(loadRosterFile).mockReturnValue({
    resolved: [rosterEntry],
    unresolved: [],
    generatedAt: "",
  });
});

describe("cascade_epic_notion_updates", () => {
  it("returns early when sprint diff is unchanged", async () => {
    const log = sprintLog({ diffChanged: false, added: [] });
    const result = await cascadeEpicNotionUpdatesTool.execute({}, mockContext(log));
    expect(result.updated).toEqual([]);
    expect(result.summary).toContain("unchanged");
    expect(callJiraTool).not.toHaveBeenCalled();
  });

  it("throws for unknown assignee before LLM or Notion", async () => {
    const log = sprintLog({
      sprintIssues: [makeIssue("X-1", { assigneeAccountId: UNKNOWN_ID })],
    });
    await expect(cascadeEpicNotionUpdatesTool.execute({}, mockContext(log))).rejects.toThrow(
      /Unknown roster assignee/,
    );
    expect(callJiraTool).not.toHaveBeenCalled();
    expect(callNotionTool).not.toHaveBeenCalled();
  });

  it("records notCreated for unmapped work page", async () => {
    vi.mocked(loadRosterFile).mockReturnValue({
      resolved: [{ ...rosterEntry, workPages: [] }],
      unresolved: [],
      generatedAt: "",
    });
    const result = await cascadeEpicNotionUpdatesTool.execute({}, mockContext(sprintLog()));
    expect(result.notCreated).toHaveLength(1);
    expect(result.notCreated[0].reason).toBe("not created");
    expect(result.updated).toEqual([]);
    expect(callJiraTool).not.toHaveBeenCalled();
  });

  it("skips target with no open work", async () => {
    mockEpicSearchIssues(0);
    const result = await cascadeEpicNotionUpdatesTool.execute({}, mockContext(sprintLog()));
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe("no open work");
    expect(result.updated).toEqual([]);
    expect(callNotionTool).not.toHaveBeenCalled();
  });

  it("updates Notion on happy path", async () => {
    mockEpicSearchIssues(1);
    const log = sprintLog();
    const result = await cascadeEpicNotionUpdatesTool.execute({}, mockContext(log));

    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].pageUrl).toBe(WORK_PAGE);
    expect(result.updated[0].epicKeys).toEqual(["PROJ-100"]);
    expect(callNotionTool).toHaveBeenCalledWith(
      "notion-update-page",
      expect.objectContaining({
        command: "replace_content",
        new_str: expect.stringContaining("**Epic:**"),
      }),
    );
  });

  it("builds epic JQL without statusCategories", async () => {
    mockEpicSearchIssues(1);
    await cascadeEpicNotionUpdatesTool.execute({}, mockContext(sprintLog()));

    const buildResult = await buildEpicJqlTool.execute(
      { epicKeys: ["PROJ-100"], assignee: ALICE_ID },
      mockContext([]),
    ) as { jql: string };
    expect(buildResult.jql).not.toMatch(/statusCategory/);
  });

  it("includes unassigned keys in result", async () => {
    const log = sprintLog({
      sprintIssues: [makeIssue("X-1", { assigneeAccountId: null, assignee: null })],
      added: ["X-1"],
    });
    const result = await cascadeEpicNotionUpdatesTool.execute({}, mockContext(log));
    expect(result.unassignedKeys).toEqual(["X-1"]);
    expect(result.updated).toEqual([]);
  });

  // Scenario: Changed sprint diff — first run with no baseline still cascades
  it("cascades on first run when baselineTimestamp is null", async () => {
    mockEpicSearchIssues(1);
    const log = sprintLog({ baselineTimestamp: null });
    const result = await cascadeEpicNotionUpdatesTool.execute({}, mockContext(log));
    expect(result.updated).toHaveLength(1);
  });

  // Scenario: All targets resolved — updates mapped epic while unmapped goes to notCreated
  it("updates mapped epic and records notCreated for unmapped on same run", async () => {
    vi.mocked(loadRosterFile).mockReturnValue({
      resolved: [{
        ...rosterEntry,
        workPages: [{ page: WORK_PAGE, epics: ["PROJ-100"] }],
      }],
      unresolved: [],
      generatedAt: "",
    });
    mockEpicSearchIssues(1, "PROJ-100");
    const log = sprintLog({
      added: ["X-1", "X-2"],
      sprintIssues: [
        makeIssue("X-1", { parent: { key: "PROJ-100", summary: "Alpha", issueType: "Epic" } }),
        makeIssue("X-2", { parent: { key: "PROJ-999", summary: "Unmapped", issueType: "Epic" } }),
      ],
    });
    const result = await cascadeEpicNotionUpdatesTool.execute({}, mockContext(log));
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].epicKeys).toEqual(["PROJ-100"]);
    expect(result.notCreated).toEqual([
      expect.objectContaining({ epicKey: "PROJ-999", reason: "not created" }),
    ]);
    expect(callNotionTool).toHaveBeenCalledTimes(1);
  });

  // Scenario: Dedupe by work page — build_epic_jql receives all epics on the work page entry
  it("passes all rollup epic keys to build_epic_jql for one work page", async () => {
    vi.mocked(loadRosterFile).mockReturnValue({
      resolved: [{
        ...rosterEntry,
        workPages: [{ page: WORK_PAGE, epics: ["PROJ-100", "PROJ-200"] }],
      }],
      unresolved: [],
      generatedAt: "",
    });
    const buildSpy = vi.spyOn(buildEpicJqlTool, "execute");
    mockEpicSearchIssues(1, "PROJ-100");
    const log = sprintLog({
      added: ["X-1", "X-2"],
      sprintIssues: [
        makeIssue("X-1", { parent: { key: "PROJ-100", summary: "Alpha", issueType: "Epic" } }),
        makeIssue("X-2", { parent: { key: "PROJ-200", summary: "Beta", issueType: "Epic" } }),
      ],
    });
    await cascadeEpicNotionUpdatesTool.execute({}, mockContext(log));
    expect(buildSpy).toHaveBeenCalledWith(
      expect.objectContaining({ epicKeys: ["PROJ-100", "PROJ-200"], assignee: ALICE_ID }),
      expect.anything(),
    );
    buildSpy.mockRestore();
  });

  // Scenario: No epic diff gate — epic pipeline saves snapshot but never diffs
  it("saves epic snapshot without running epic diff", async () => {
    const snapshotSpy = vi.spyOn(jiraSearchSnapshotsTool, "execute");
    mockEpicSearchIssues(1);
    await cascadeEpicNotionUpdatesTool.execute({}, mockContext(sprintLog()));
    const actions = snapshotSpy.mock.calls.map((call) => (call[0] as { action: string }).action);
    expect(actions).toEqual(["save"]);
    expect(actions).not.toContain("diff");
    snapshotSpy.mockRestore();
  });

  // Scenario: Per-page pipeline — tools run in order through Notion replace
  it("runs build → search → save → group → generate → update_notion_page in order", async () => {
    const order: string[] = [];
    const spies = [
      wrapExecute(buildEpicJqlTool, "build_epic_jql", order),
      wrapExecute(searchIssuesTool, "search_jira_issues", order),
      wrapExecute(jiraSearchSnapshotsTool, "jira_search_snapshots", order),
      wrapExecute(groupIssuesTool, "group_issues", order),
      wrapExecute(generateEpicNarrativeTool, "generate_epic_narrative", order),
      wrapExecute(updateNotionPageTool, "update_notion_page", order),
    ];
    mockEpicSearchIssues(1);
    await cascadeEpicNotionUpdatesTool.execute({}, mockContext(sprintLog()));
    expect(order).toEqual([
      "build_epic_jql",
      "search_jira_issues",
      "jira_search_snapshots",
      "group_issues",
      "generate_epic_narrative",
      "update_notion_page",
    ]);
    for (const spy of spies) spy.mockRestore();
  });

  // Scenario: Summary fields
  it("returns updated, skipped, notCreated, and unassignedKeys in the result", async () => {
    vi.mocked(loadRosterFile).mockReturnValue({
      resolved: [{
        ...rosterEntry,
        workPages: [{ page: WORK_PAGE, epics: ["PROJ-100"] }],
      }],
      unresolved: [],
      generatedAt: "",
    });
    mockEpicSearchIssues(1, "PROJ-100");
    const log = sprintLog({
      added: ["X-1", "X-2", "X-3"],
      sprintIssues: [
        makeIssue("X-1"),
        makeIssue("X-2", { assigneeAccountId: null, assignee: null, parent: { key: "PROJ-100", summary: "Alpha", issueType: "Epic" } }),
        makeIssue("X-3", { parent: { key: "PROJ-999", summary: "Unmapped", issueType: "Epic" } }),
      ],
    });
    const result = await cascadeEpicNotionUpdatesTool.execute({}, mockContext(log));
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({
      assigneeAccountId: ALICE_ID,
      assigneeDisplayName: "Alice Martin",
      pageUrl: WORK_PAGE,
      epicKeys: ["PROJ-100"],
    });
    expect(result.skipped).toEqual([]);
    expect(result.notCreated).toEqual([
      expect.objectContaining({ epicKey: "PROJ-999", reason: "not created" }),
    ]);
    expect(result.unassignedKeys).toEqual(["X-2"]);
    expect(result.summary).toContain("1 page(s) updated");
    expect(result.summary).toContain("1 not created");
    expect(result.summary).toContain("1 unassigned");
  });
});
