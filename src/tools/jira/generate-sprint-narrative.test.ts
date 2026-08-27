import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setCacheRoot } from "../../lib/cache.js";
import {
  assembleMarkdown,
  assembleThreeLevelMarkdown,
  renderHeading,
  getSubGroupIssues,
  linkifyIssueKeys,
  buildGroupMessage,
  buildChangedKeySet,
  buildDiffSignals,
  isGroupAffectedByDiff,
  splitMarkdownSections,
  flattenToEpicUnits,
  upgradeAssigneeGrouping,
  generateSprintNarrativeTool,
  findPriorNarrativeInLog,
  type GroupNarrative,
  type AssembleResult,
  type EpicUnit,
} from "./generate-sprint-narrative.js";
import { saveNarrativeCache, computeThread } from "./narrative-cache.js";
import type { IssueGroup, GroupIssuesResult } from "./group-issues.js";
import type { JiraIssue } from "./search-issues.js";
import { SUBMIT_NARRATIVE_TOOL } from "../../lib/narrative-llm.js";

const JIRA_BASE = "https://example.atlassian.net/browse";
const PROMPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../prompts");

function mockNarrativeLlm(
  handler: () => { content?: string | null; toolCalls?: Array<{ arguments: Record<string, unknown> }> },
) {
  return {
    generate: vi.fn(),
    generateWithTools: vi.fn(async () => {
      const result = handler();
      if (result.toolCalls) {
        return {
          content: result.content ?? null,
          toolCalls: result.toolCalls.map((tc, idx) => ({
            id: `tool-${idx + 1}`,
            name: SUBMIT_NARRATIVE_TOOL.name,
            arguments: tc.arguments,
          })),
          finishReason: "tool_calls" as const,
        };
      }
      return {
        content: result.content ?? null,
        toolCalls: [],
        finishReason: "stop" as const,
      };
    }),
  };
}

function narrativeToolResponse(args: Record<string, unknown>) {
  return { toolCalls: [{ arguments: args }] };
}

function makeIssue(key: string, overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key,
    summary: `Summary for ${key}`,
    status: "Done",
    statusCategory: "Done",
    priority: "Medium",
    assignee: "Alice",
    issueType: "Story",
    description: null,
    ...overrides,
  };
}

function makeGrouped(groups: IssueGroup[], groupBy: string[] = ["epic", "status"]): GroupIssuesResult {
  return { groups, groupBy, dropped: 0, summary: "test" };
}

function makeEpicGroup(key: string, label: string, statuses: { done?: JiraIssue[]; inProgress?: JiraIssue[]; notStarted?: JiraIssue[] }): IssueGroup {
  const allIssues = [...(statuses.done ?? []), ...(statuses.inProgress ?? []), ...(statuses.notStarted ?? [])];
  const subGroups: IssueGroup[] = [];
  if (statuses.done?.length) subGroups.push({ groupKey: "done", groupLabel: "Done", issues: statuses.done });
  if (statuses.inProgress?.length) subGroups.push({ groupKey: "in_progress", groupLabel: "In Progress", issues: statuses.inProgress });
  if (statuses.notStarted?.length) subGroups.push({ groupKey: "not_started", groupLabel: "Not Started", issues: statuses.notStarted });
  return { groupKey: key, groupLabel: label, issues: allIssues, subGroups };
}

// --- renderHeading ---

describe("renderHeading", () => {
  it("renders epic heading with link", () => {
    const group: IssueGroup = { groupKey: "PROJ-100", groupLabel: "User Onboarding", issues: [] };
    expect(renderHeading(group, "epic", JIRA_BASE)).toBe(
      "## User Onboarding ([PROJ-100](https://example.atlassian.net/browse/PROJ-100))"
    );
  });

  it("renders standalone items for _no_epic_", () => {
    const group: IssueGroup = { groupKey: "_no_epic_", groupLabel: "Other", issues: [] };
    expect(renderHeading(group, "epic", JIRA_BASE)).toBe("## Standalone Items");
  });

  it("renders assignee heading without link", () => {
    const group: IssueGroup = { groupKey: "alice", groupLabel: "Alice Smith", issues: [] };
    expect(renderHeading(group, "assignee", JIRA_BASE)).toBe("## Alice Smith");
  });
});

// --- getSubGroupIssues ---

describe("getSubGroupIssues", () => {
  it("returns issues for matching subgroup", () => {
    const issue = makeIssue("X-1");
    const group: IssueGroup = {
      groupKey: "test", groupLabel: "Test", issues: [issue],
      subGroups: [{ groupKey: "done", groupLabel: "Done", issues: [issue] }],
    };
    expect(getSubGroupIssues(group, "done")).toEqual([issue]);
  });

  it("returns empty for missing subgroup", () => {
    const group: IssueGroup = {
      groupKey: "test", groupLabel: "Test", issues: [],
      subGroups: [{ groupKey: "done", groupLabel: "Done", issues: [] }],
    };
    expect(getSubGroupIssues(group, "in_progress")).toEqual([]);
  });

  it("returns empty when no subGroups", () => {
    const group: IssueGroup = { groupKey: "test", groupLabel: "Test", issues: [] };
    expect(getSubGroupIssues(group, "done")).toEqual([]);
  });
});

// --- assembleMarkdown ---

describe("assembleMarkdown", () => {
  it("matches LLM groups by exact groupKey", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-100", "User Onboarding", { done: [makeIssue("X-1")] }),
      makeEpicGroup("PROJ-200", "Data Export", { inProgress: [makeIssue("X-2")] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "PROJ-100", done: ["Onboarding is complete."] },
      { groupKey: "PROJ-200", inProgress: ["Export is in progress."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Onboarding is complete.");
    expect(md).toContain("Export is in progress.");
    expect(md).not.toContain("_No narrative generated._");
  });

  it("matches LLM groups by label when key doesn't match", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-100", "User Onboarding", { done: [makeIssue("X-1")] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "User Onboarding", done: ["Matched by label."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Matched by label.");
    expect(md).not.toContain("_No narrative generated._");
  });

  it("matches LLM groups by label case-insensitively", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-100", "User Onboarding", { done: [makeIssue("X-1")] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "user onboarding", done: ["Case insensitive match."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Case insensitive match.");
  });

  it("sorts groups alphabetically by label", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-2", "Zebra Feature", { done: [makeIssue("X-2")] }),
      makeEpicGroup("PROJ-1", "Alpha Feature", { done: [makeIssue("X-1")] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "PROJ-2", done: ["Zebra prose."] },
      { groupKey: "PROJ-1", done: ["Alpha prose."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    const alphaIdx = md.indexOf("Alpha prose.");
    const zebraIdx = md.indexOf("Zebra prose.");
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  it("puts special keys (_no_epic_) last regardless of label", () => {
    const grouped = makeGrouped([
      makeEpicGroup("_no_epic_", "Other Work", { done: [makeIssue("X-2")] }),
      makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "_no_epic_", done: ["Standalone prose."] },
      { groupKey: "PROJ-1", done: ["Alpha prose."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    const alphaIdx = md.indexOf("Alpha prose.");
    const standaloneIdx = md.indexOf("Standalone prose.");
    expect(alphaIdx).toBeLessThan(standaloneIdx);
  });

  it("renders fallback for groups the LLM missed", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] }),
      makeEpicGroup("PROJ-2", "Beta", { inProgress: [makeIssue("X-2")] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "PROJ-1", done: ["Alpha prose."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Alpha prose.");
    expect(md).toContain("## Beta");
    expect(md).toContain("_No narrative generated._");
  });

  it("skips groups with no issues in any status", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] }),
      { groupKey: "PROJ-2", groupLabel: "Empty", issues: [], subGroups: [] },
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "PROJ-1", done: ["Alpha."] },
      { groupKey: "PROJ-2", done: ["Should not appear."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Alpha.");
    expect(md).not.toContain("Should not appear.");
    expect(md).not.toContain("Empty");
  });

  it("renders all three status sections when present", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-1", "Full Epic", {
        done: [makeIssue("X-1")],
        inProgress: [makeIssue("X-2")],
        notStarted: [makeIssue("X-3")],
      }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      {
        groupKey: "PROJ-1",
        done: ["Done prose."],
        inProgress: ["WIP prose."],
        notStarted: ["Pending prose."],
      },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("### What's Been Done\n\nDone prose.");
    expect(md).toContain("### What's In Motion\n\nWIP prose.");
    expect(md).toContain("### Not Started\n\nPending prose.");
  });

  it("handles empty parsedGroups gracefully (all fallback)", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] }),
    ]);

    const { markdown: md } = assembleMarkdown(grouped, [], JIRA_BASE);
    expect(md).toContain("## Alpha");
    expect(md).toContain("_No narrative generated._");
  });

  it("handles trimmed keys from LLM", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-914", "Clean Claims", { done: [makeIssue("X-1")] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: " PROJ-914 ", done: ["Trimmed key match."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Trimmed key match.");
  });

  it("adds assignee names after the heading", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-1", "Alpha", {
        done: [makeIssue("X-1", { assignee: "Bob" })],
        inProgress: [makeIssue("X-2", { assignee: "Alice" })],
      }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "PROJ-1", done: ["Done."], inProgress: ["WIP."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    const headingIdx = md.indexOf("## Alpha");
    const assigneeIdx = md.indexOf("**Alice, Bob**");
    expect(assigneeIdx).toBeGreaterThan(headingIdx);
    expect(assigneeIdx).toBeLessThan(md.indexOf("Done."));
  });

  it("deduplicates assignees across statuses", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-1", "Alpha", {
        done: [makeIssue("X-1", { assignee: "Alice" })],
        inProgress: [makeIssue("X-2", { assignee: "Alice" })],
      }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "PROJ-1", done: ["Done."], inProgress: ["WIP."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("**Alice**");
    expect(md).not.toContain("Alice, Alice");
  });

  it("omits assignee line when all unassigned", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-1", "Alpha", {
        done: [makeIssue("X-1", { assignee: null })],
      }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "PROJ-1", done: ["Done."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).not.toContain("**");
  });

  it("linkifies bare issue keys in prose", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-1", "Alpha", { inProgress: [makeIssue("WORK-100")] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "PROJ-1", inProgress: ["Work is underway (WORK-100 · Alice)."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain(`([WORK-100](${JIRA_BASE}/WORK-100) · Alice)`);
    expect(md).not.toMatch(/\(WORK-100 ·/);
  });
});

// --- assembleMarkdown: assignee grouping ---

describe("assembleMarkdown (assignee grouping)", () => {
  function makeAssigneeGrouped(groups: IssueGroup[]): GroupIssuesResult {
    return { groups, groupBy: ["assignee", "status"] as any, dropped: 0, summary: "test" };
  }

  function makeAssigneeGroup(name: string, statuses: { done?: JiraIssue[]; inProgress?: JiraIssue[]; notStarted?: JiraIssue[] }): IssueGroup {
    const allIssues = [...(statuses.done ?? []), ...(statuses.inProgress ?? []), ...(statuses.notStarted ?? [])];
    const subGroups: IssueGroup[] = [];
    if (statuses.done?.length) subGroups.push({ groupKey: "done", groupLabel: "Done", issues: statuses.done });
    if (statuses.inProgress?.length) subGroups.push({ groupKey: "in_progress", groupLabel: "In Progress", issues: statuses.inProgress });
    if (statuses.notStarted?.length) subGroups.push({ groupKey: "not_started", groupLabel: "Not Started", issues: statuses.notStarted });
    return { groupKey: name, groupLabel: name, issues: allIssues, subGroups };
  }

  it("matches LLM groups by exact assignee name", () => {
    const grouped = makeAssigneeGrouped([
      makeAssigneeGroup("Dan Torres", { done: [makeIssue("X-1", { assignee: "Dan Torres" })] }),
      makeAssigneeGroup("Alice Martin", { inProgress: [makeIssue("X-2", { assignee: "Alice Martin" })] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "Dan Torres", done: ["Dan delivered work."] },
      { groupKey: "Alice Martin", inProgress: ["Alice is working."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Dan delivered work.");
    expect(md).toContain("Alice is working.");
    expect(md).not.toContain("_No narrative generated._");
  });

  it("matches LLM groups by case-insensitive assignee name", () => {
    const grouped = makeAssigneeGrouped([
      makeAssigneeGroup("Dan Torres", { done: [makeIssue("X-1", { assignee: "Dan Torres" })] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "dan torres", done: ["Case insensitive match."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Case insensitive match.");
    expect(md).not.toContain("_No narrative generated._");
  });

  it("matches LLM groups with extra whitespace in assignee name", () => {
    const grouped = makeAssigneeGrouped([
      makeAssigneeGroup("Dan Torres", { done: [makeIssue("X-1", { assignee: "Dan Torres" })] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: " Dan Torres ", done: ["Whitespace match."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Whitespace match.");
    expect(md).not.toContain("_No narrative generated._");
  });

  it("does NOT render redundant assignee bold line under heading", () => {
    const grouped = makeAssigneeGrouped([
      makeAssigneeGroup("Dan Torres", { done: [makeIssue("X-1", { assignee: "Dan Torres" })] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "Dan Torres", done: ["Delivered."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("## Dan Torres");
    expect(md).not.toContain("**Dan Torres**");
  });

  it("renders all status sections for an assignee", () => {
    const grouped = makeAssigneeGrouped([
      makeAssigneeGroup("Alice", {
        done: [makeIssue("X-1", { assignee: "Alice" })],
        inProgress: [makeIssue("X-2", { assignee: "Alice" })],
        notStarted: [makeIssue("X-3", { assignee: "Alice" })],
      }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      {
        groupKey: "Alice",
        done: ["Done prose."],
        inProgress: ["WIP prose."],
        notStarted: ["Pending prose."],
      },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Done prose.");
    expect(md).toContain("### What's In Motion\n\nWIP prose.");
    expect(md).toContain("### Not Started\n\nPending prose.");
  });

  it("still renders assignee bold line for epic grouping", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-1", "Alpha", {
        done: [makeIssue("X-1", { assignee: "Bob" })],
      }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "PROJ-1", done: ["Done."] },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("**Bob**");
  });

  it("handles empty parsedGroups for assignee grouping (all fallback)", () => {
    const grouped = makeAssigneeGrouped([
      makeAssigneeGroup("Alice", { done: [makeIssue("X-1", { assignee: "Alice" })] }),
    ]);

    const { markdown: md } = assembleMarkdown(grouped, [], JIRA_BASE);
    expect(md).toContain("## Alice");
    expect(md).toContain("_No narrative generated._");
    expect(md).not.toContain("**Alice**");
  });
});

// --- linkifyIssueKeys ---

describe("linkifyIssueKeys", () => {
  it("links bare issue keys", () => {
    const text = "Work is underway (WORK-100 · Alice).";
    const keys = new Set(["WORK-100"]);
    const result = linkifyIssueKeys(text, keys, JIRA_BASE);
    expect(result).toBe(`Work is underway ([WORK-100](${JIRA_BASE}/WORK-100) · Alice).`);
  });

  it("does not double-link already linked keys", () => {
    const text = `Already linked ([WORK-100](${JIRA_BASE}/WORK-100) · Alice).`;
    const keys = new Set(["WORK-100"]);
    const result = linkifyIssueKeys(text, keys, JIRA_BASE);
    expect(result).toBe(text);
  });

  it("links multiple different keys", () => {
    const text = "Done by WORK-100 and PROJ-200.";
    const keys = new Set(["WORK-100", "PROJ-200"]);
    const result = linkifyIssueKeys(text, keys, JIRA_BASE);
    expect(result).toContain(`[WORK-100](${JIRA_BASE}/WORK-100)`);
    expect(result).toContain(`[PROJ-200](${JIRA_BASE}/PROJ-200)`);
  });

  it("returns text unchanged when no keys match", () => {
    const text = "No issue keys here.";
    const keys = new Set(["WORK-999"]);
    expect(linkifyIssueKeys(text, keys, JIRA_BASE)).toBe(text);
  });
});

describe("assembleMarkdown diagnostics", () => {
  function makeGrouped(groups: IssueGroup[]): GroupIssuesResult {
    return { groups, groupBy: ["epic", "status"], total: groups.length, dropped: 0, summary: "test" };
  }

  const doneIssue = makeIssue("PROJ-1", { status: "Done", statusCategory: "Done" });
  const ipIssue = makeIssue("PROJ-2", { status: "In Progress", statusCategory: "In Progress" });

  it("reports all matched when LLM keys align", () => {
    const grouped = makeGrouped([
      {
        groupKey: "Alpha",
        groupLabel: "Alpha",
        issues: [],
        subGroups: [
          { groupKey: "done", groupLabel: "Done", issues: [doneIssue], subGroups: [] },
          { groupKey: "in_progress", groupLabel: "In Progress", issues: [ipIssue], subGroups: [] },
        ],
      },
    ]);
    const prose: GroupNarrative[] = [
      { groupKey: "Alpha", done: ["Done."], inProgress: ["Moving."] },
    ];
    const result = assembleMarkdown(grouped, prose, JIRA_BASE);
    expect(result.matched).toBe(1);
    expect(result.total).toBe(1);
    expect(result.unmatchedKeys).toEqual([]);
  });

  it("reports unmatched when LLM returns wrong keys", () => {
    const grouped = makeGrouped([
      {
        groupKey: "Alpha",
        groupLabel: "Alpha",
        issues: [],
        subGroups: [
          { groupKey: "done", groupLabel: "Done", issues: [doneIssue], subGroups: [] },
        ],
      },
    ]);
    const prose: GroupNarrative[] = [
      { groupKey: "Wrong Key", done: ["Done."] },
    ];
    const result = assembleMarkdown(grouped, prose, JIRA_BASE);
    expect(result.matched).toBe(0);
    expect(result.total).toBe(1);
    expect(result.unmatchedKeys).toContain("Wrong Key");
    expect(result.markdown).toContain("_No narrative generated._");
  });

  it("reports partial matches", () => {
    const grouped = makeGrouped([
      {
        groupKey: "Alpha",
        groupLabel: "Alpha",
        issues: [],
        subGroups: [
          { groupKey: "done", groupLabel: "Done", issues: [doneIssue], subGroups: [] },
        ],
      },
      {
        groupKey: "Beta",
        groupLabel: "Beta",
        issues: [],
        subGroups: [
          { groupKey: "in_progress", groupLabel: "In Progress", issues: [ipIssue], subGroups: [] },
        ],
      },
    ]);
    const prose: GroupNarrative[] = [
      { groupKey: "Alpha", done: ["Done."] },
      { groupKey: "Gamma", done: ["Not matching."] },
    ];
    const result = assembleMarkdown(grouped, prose, JIRA_BASE);
    expect(result.matched).toBe(1);
    expect(result.total).toBe(2);
    expect(result.unmatchedKeys).toContain("Gamma");
  });

  it("resolves composite keys like 'KEY — Label'", () => {
    const grouped = makeGrouped([
      {
        groupKey: "PROJ-100",
        groupLabel: "Feature Alpha",
        issues: [],
        subGroups: [
          { groupKey: "in_progress", groupLabel: "In Progress", issues: [ipIssue], subGroups: [] },
        ],
      },
    ]);
    const prose: GroupNarrative[] = [
      { groupKey: "PROJ-100 — Feature Alpha", inProgress: ["Work happening."] },
    ];
    const result = assembleMarkdown(grouped, prose, JIRA_BASE);
    expect(result.matched).toBe(1);
    expect(result.unmatchedKeys).toEqual([]);
    expect(result.markdown).toContain("Work happening.");
    expect(result.markdown).not.toContain("_No narrative generated._");
  });

  it("resolves composite keys by label suffix when key doesn't match", () => {
    const grouped = makeGrouped([
      {
        groupKey: "PROJ-200",
        groupLabel: "Feature Beta",
        issues: [],
        subGroups: [
          { groupKey: "done", groupLabel: "Done", issues: [doneIssue], subGroups: [] },
        ],
      },
    ]);
    const prose: GroupNarrative[] = [
      { groupKey: "WRONG-999 — Feature Beta", done: ["Shipped it."] },
    ];
    const result = assembleMarkdown(grouped, prose, JIRA_BASE);
    expect(result.matched).toBe(1);
    expect(result.markdown).toContain("Shipped it.");
  });
});

// --- buildGroupMessage ---

describe("buildGroupMessage", () => {
  it("builds a message for an epic group with status sub-sections", () => {
    const group = makeEpicGroup("PROJ-1", "User Onboarding", {
      done: [makeIssue("X-1")],
      inProgress: [makeIssue("X-2", { status: "In Review", statusCategory: "In Progress" })],
    });

    const msg = buildGroupMessage(group, "epic", JIRA_BASE, 1000);
    expect(msg).toContain("Write prose for this single epic.");
    expect(msg).toContain("GROUP KEY: PROJ-1");
    expect(msg).toContain("GROUP LABEL: User Onboarding");
    expect(msg).toContain("done (1):");
    expect(msg).toContain("inProgress (1):");
    expect(msg).toContain("X-1");
    expect(msg).toContain("X-2");
  });

  it("builds a message for an assignee group with epic tags", () => {
    const issue = makeIssue("X-1", {
      parent: { key: "PROJ-50", summary: "Clean Claims", issueType: "Epic" } as any,
    });
    const group: IssueGroup = {
      groupKey: "Alice Martin",
      groupLabel: "Alice Martin",
      issues: [issue],
      subGroups: [{ groupKey: "done", groupLabel: "Done", issues: [issue] }],
    };

    const msg = buildGroupMessage(group, "assignee", JIRA_BASE, 1000);
    expect(msg).toContain("Write prose for this single team member.");
    expect(msg).toContain("GROUP KEY: Alice Martin");
    expect(msg).toContain("[Epic: PROJ-50 — Clean Claims]");
  });

  it("includes JIRA_BASE in the message", () => {
    const group = makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] });
    const msg = buildGroupMessage(group, "epic", JIRA_BASE, 1000);
    expect(msg).toContain(`JIRA_BASE: ${JIRA_BASE}`);
  });

  it("includes Jira workflow status on each issue", () => {
    const group = makeEpicGroup("PROJ-1", "Alpha", {
      inProgress: [
        makeIssue("X-1", { status: "QA", statusCategory: "In Progress" }),
        makeIssue("X-2", { status: "Code Merged", statusCategory: "In Progress" }),
      ],
    });
    const msg = buildGroupMessage(group, "epic", JIRA_BASE, 1000);
    expect(msg).toContain("[Status: QA]");
    expect(msg).toContain("[Status: Code Merged]");
  });
});

describe("narrative prompts", () => {
  it("sprint prompt forbids bolt-on QA delivery language", () => {
    const prompt = readFileSync(join(PROMPTS_DIR, "sprint-narrative.md"), "utf-8");
    expect(prompt).toContain("Do NOT write delivery prose and bolt on");
    expect(prompt).toContain("QA is validating");
  });

  it("epic prompt forbids bolt-on QA delivery language", () => {
    const prompt = readFileSync(join(PROMPTS_DIR, "epic-narrative.md"), "utf-8");
    expect(prompt).toContain("Do NOT write delivery prose and bolt on");
    expect(prompt).toContain("QA is validating");
  });
});

// --- parallel execute ---

describe("generateSprintNarrativeTool.execute (parallel)", () => {

  function makeContext(groups: IssueGroup[], groupBy: string[] = ["epic", "status"]) {
    const callCount = { n: 0 };
    return {
      context: {
        toolCallLog: [
          {
            tool: "group_issues",
            args: {},
            result: { groups, groupBy, dropped: 0, summary: "test" } as GroupIssuesResult,
          },
        ],
        config: { issueLinkBase: JIRA_BASE },
        llm: mockNarrativeLlm(() => {
          callCount.n++;
          const groupIdx = callCount.n - 1;
          const key = groups[groupIdx]?.groupKey ?? "unknown";
          return narrativeToolResponse({
            groupKey: key,
            done: [`Prose for ${key}.`],
          });
        }),
      },
      callCount,
    };
  }

  it("makes one LLM call per group", async () => {
    const groups = [
      makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] }),
      makeEpicGroup("PROJ-2", "Beta", { done: [makeIssue("X-2")] }),
      makeEpicGroup("PROJ-3", "Gamma", { done: [makeIssue("X-3")] }),
    ];

    const { context } = makeContext(groups);
    const result = await generateSprintNarrativeTool.execute!({}, context as any);

    expect(context.llm.generateWithTools).toHaveBeenCalledTimes(3);
    expect((result as any).narrative).toContain("Prose for PROJ-1.");
    expect((result as any).narrative).toContain("Prose for PROJ-2.");
    expect((result as any).narrative).toContain("Prose for PROJ-3.");
  });

  it("handles individual group parse failures gracefully", async () => {
    const groups = [
      makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] }),
      makeEpicGroup("PROJ-2", "Beta", { done: [makeIssue("X-2")] }),
    ];

    let callN = 0;
    const context = {
      toolCallLog: [
        {
          tool: "group_issues",
          args: {},
          result: { groups, groupBy: ["epic", "status"], dropped: 0, summary: "test" } as GroupIssuesResult,
        },
      ],
      config: { issueLinkBase: JIRA_BASE },
      llm: mockNarrativeLlm(() => {
        callN++;
        if (callN === 1) return { content: "not valid json at all" };
        return narrativeToolResponse({ groupKey: "PROJ-2", done: ["Beta works."] });
      }),
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    expect(context.llm.generateWithTools).toHaveBeenCalledTimes(3);
    expect((result as any).narrative).toContain("Beta works.");
    expect((result as any).narrative).toContain("_No narrative generated._");
  });

  it("preserves quoted UI copy from tool response in markdown", async () => {
    const groups = [
      {
        groupKey: "Alice Martin",
        groupLabel: "Alice Martin",
        issues: [makeIssue("X-1", { assignee: "Alice Martin", status: "Open", statusCategory: "To Do" })],
        subGroups: [{
          groupKey: "not_started",
          groupLabel: "Not Started",
          issues: [makeIssue("X-1", { assignee: "Alice Martin", status: "Open", statusCategory: "To Do" })],
        }],
      },
    ];

    const context = {
      toolCallLog: [{
        tool: "group_issues",
        args: {},
        result: { groups, groupBy: ["assignee", "status"], dropped: 0, summary: "test" } as GroupIssuesResult,
      }],
      config: { issueLinkBase: JIRA_BASE },
      llm: mockNarrativeLlm(() =>
        narrativeToolResponse({
          groupKey: "Alice Martin",
          notStarted: [
            'PreCheck will show "No insurance information on file" instead of a misleading field error.',
          ],
        }),
      ),
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    expect((result as any).narrative).toContain('"No insurance information on file"');
    expect((result as any).narrative).not.toContain("_No narrative generated._");
  });

  it("works with assignee grouping", async () => {
    const groups = [
      {
        groupKey: "Alice Martin",
        groupLabel: "Alice Martin",
        issues: [makeIssue("X-1", { assignee: "Alice Martin" })],
        subGroups: [{ groupKey: "done", groupLabel: "Done", issues: [makeIssue("X-1", { assignee: "Alice Martin" })] }],
      },
    ];

    let callN = 0;
    const context = {
      toolCallLog: [
        {
          tool: "group_issues",
          args: {},
          result: { groups, groupBy: ["assignee", "status"], dropped: 0, summary: "test" } as GroupIssuesResult,
        },
      ],
      config: { issueLinkBase: JIRA_BASE },
      llm: mockNarrativeLlm(() =>
        narrativeToolResponse({ groupKey: "Alice Martin", done: ["Alice delivered."] }),
      ),
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    expect(context.llm.generateWithTools).toHaveBeenCalledTimes(1);
    expect((result as any).narrative).toContain("Alice delivered.");
  });
});

// --- flattenToEpicUnits ---

describe("upgradeAssigneeGrouping", () => {
  it("upgrades assignee → status to assignee → status → epic", () => {
    const issues = [
      makeIssue("A-1", { assignee: "Alice", parent: { key: "EPIC-1", summary: "Epic One", issueType: "Epic" } }),
      makeIssue("A-2", { assignee: "Alice", statusCategory: "In Progress", status: "In Progress", parent: { key: "EPIC-2", summary: "Epic Two", issueType: "Epic" } }),
    ];
    const grouped = makeGrouped([
      makeEpicGroup("Alice", "Alice", { done: [issues[0]], inProgress: [issues[1]] }),
    ], ["assignee", "status"]);

    const upgraded = upgradeAssigneeGrouping(grouped, issues);
    expect(upgraded.groupBy).toEqual(["assignee", "status", "epic"]);
    expect(upgraded.groups[0].subGroups?.[0].subGroups?.length).toBeGreaterThan(0);
  });

  it("leaves epic grouping unchanged", () => {
    const grouped = makeGrouped([], ["epic", "status"]);
    expect(upgradeAssigneeGrouping(grouped, [])).toBe(grouped);
  });
});

describe("flattenToEpicUnits", () => {
  function make3LevelGrouped(): GroupIssuesResult {
    return {
      groups: [
        {
          groupKey: "Alice",
          groupLabel: "Alice",
          issues: [
            makeIssue("X-1", { assignee: "Alice", status: "Done", statusCategory: "Done" }),
            makeIssue("X-2", { assignee: "Alice", status: "In Review", statusCategory: "In Progress" }),
            makeIssue("X-3", { assignee: "Alice", status: "In Progress", statusCategory: "In Progress" }),
          ],
          subGroups: [
            {
              groupKey: "done", groupLabel: "Done",
              issues: [makeIssue("X-1", { assignee: "Alice" })],
              subGroups: [
                { groupKey: "PROJ-50", groupLabel: "Clean Claims", issues: [makeIssue("X-1", { assignee: "Alice" })] },
              ],
            },
            {
              groupKey: "in_progress", groupLabel: "In Progress",
              issues: [
                makeIssue("X-2", { assignee: "Alice", status: "In Review", statusCategory: "In Progress" }),
                makeIssue("X-3", { assignee: "Alice", status: "In Progress", statusCategory: "In Progress" }),
              ],
              subGroups: [
                { groupKey: "PROJ-50", groupLabel: "Clean Claims", issues: [makeIssue("X-2", { assignee: "Alice", status: "In Review" })] },
                { groupKey: "PROJ-60", groupLabel: "Eligibility", issues: [makeIssue("X-3", { assignee: "Alice", status: "In Progress" })] },
              ],
            },
          ],
        },
      ],
      groupBy: ["assignee", "status", "epic"],
      total: 3,
      dropped: 0,
      summary: "test",
    };
  }

  it("flattens 3-level groups into (assignee × epic) units", () => {
    const grouped = make3LevelGrouped();
    const units = flattenToEpicUnits(grouped);

    expect(units).toHaveLength(2);

    const cleanClaims = units.find((u) => u.epicKey === "PROJ-50");
    expect(cleanClaims).toBeDefined();
    expect(cleanClaims!.assigneeKey).toBe("Alice");
    expect(cleanClaims!.done).toHaveLength(1);
    expect(cleanClaims!.inProgress).toHaveLength(1);

    const eligibility = units.find((u) => u.epicKey === "PROJ-60");
    expect(eligibility).toBeDefined();
    expect(eligibility!.inProgress).toHaveLength(1);
    expect(eligibility!.done).toHaveLength(0);
  });
});

// --- assembleThreeLevelMarkdown ---

describe("assembleThreeLevelMarkdown", () => {
  it("renders deterministic epic labels under each assignee", () => {
    const grouped: GroupIssuesResult = {
      groups: [
        {
          groupKey: "Alice",
          groupLabel: "Alice",
          issues: [makeIssue("X-1"), makeIssue("X-2")],
          subGroups: [
            {
              groupKey: "done", groupLabel: "Done",
              issues: [makeIssue("X-1")],
              subGroups: [{ groupKey: "PROJ-50", groupLabel: "Clean Claims", issues: [makeIssue("X-1")] }],
            },
            {
              groupKey: "in_progress", groupLabel: "In Progress",
              issues: [makeIssue("X-2", { status: "QA", statusCategory: "In Progress" })],
              subGroups: [{ groupKey: "PROJ-60", groupLabel: "Eligibility", issues: [makeIssue("X-2", { status: "QA" })] }],
            },
          ],
        },
      ],
      groupBy: ["assignee", "status", "epic"],
      total: 2,
      dropped: 0,
      summary: "test",
    };

    const units = flattenToEpicUnits(grouped);
    const proseMap = new Map<string, GroupNarrative>();
    proseMap.set("Alice::PROJ-50", { groupKey: "Alice::PROJ-50", done: ["Clean claims delivered."] });
    proseMap.set("Alice::PROJ-60", { groupKey: "Alice::PROJ-60", inProgress: ["Eligibility in progress."] });

    const result = assembleThreeLevelMarkdown(grouped, units, proseMap, JIRA_BASE);

    expect(result.markdown).toContain("## Alice");
    expect(result.markdown).toContain("### What's Been Done");
    expect(result.markdown).toContain("**Clean Claims**");
    expect(result.markdown).toContain("Clean claims delivered.");
    expect(result.markdown).toContain("### What's In Motion");
    expect(result.markdown).toContain("**Eligibility**");
    expect(result.markdown).toContain("Eligibility in progress.");
  });

  it("renders Other Work for _no_epic_ groups", () => {
    const grouped: GroupIssuesResult = {
      groups: [
        {
          groupKey: "Bob",
          groupLabel: "Bob",
          issues: [makeIssue("X-1")],
          subGroups: [
            {
              groupKey: "done", groupLabel: "Done",
              issues: [makeIssue("X-1")],
              subGroups: [{ groupKey: "_no_epic_", groupLabel: "Other Work", issues: [makeIssue("X-1")] }],
            },
          ],
        },
      ],
      groupBy: ["assignee", "status", "epic"],
      total: 1,
      dropped: 0,
      summary: "test",
    };

    const units = flattenToEpicUnits(grouped);
    const proseMap = new Map<string, GroupNarrative>();
    proseMap.set("Bob::_no_epic_", { groupKey: "Bob::_no_epic_", done: ["Standalone work."] });

    const result = assembleThreeLevelMarkdown(grouped, units, proseMap, JIRA_BASE);
    expect(result.markdown).toContain("**Other Work**");
    expect(result.markdown).toContain("Standalone work.");
  });
});

// --- buildChangedKeySet ---

// [tested] Scenario: Extracts changed keys from diff
describe("buildChangedKeySet", () => {
  it("returns null when no diff found in log", () => {
    expect(buildChangedKeySet([])).toBeNull();
  });

  it("returns null when diff has no baseline", () => {
    const log = [{
      tool: "jira_search_snapshots",
      args: { action: "diff" },
      result: { changed: true, added: ["X-1"], removed: [], statusChanges: [], baselineTimestamp: null },
    }];
    expect(buildChangedKeySet(log)).toBeNull();
  });

  it("collects added, removed, status-changed, and parent-changed keys", () => {
    const log = [{
      tool: "jira_search_snapshots",
      args: { action: "diff" },
      result: {
        changed: true,
        added: ["X-1", "X-2"],
        removed: ["X-3"],
        statusChanges: [{ key: "X-4", was: "To Do", now: "In Progress" }],
        parentChanges: [{ key: "X-5", was: "PROJ-10", now: "PROJ-20" }],
        baselineTimestamp: "2026-08-20T10:00",
      },
    }];
    const keys = buildChangedKeySet(log);
    expect(keys).not.toBeNull();
    expect(keys!.has("X-1")).toBe(true);
    expect(keys!.has("X-2")).toBe(true);
    expect(keys!.has("X-3")).toBe(true);
    expect(keys!.has("X-4")).toBe(true);
    expect(keys!.has("X-5")).toBe(true);
    expect(keys!.size).toBe(5);
  });

  it("returns empty set when diff shows no changes", () => {
    const log = [{
      tool: "jira_search_snapshots",
      args: { action: "diff" },
      result: {
        changed: false,
        added: [],
        removed: [],
        statusChanges: [],
        baselineTimestamp: "2026-08-20T10:00",
      },
    }];
    const keys = buildChangedKeySet(log);
    expect(keys).not.toBeNull();
    expect(keys!.size).toBe(0);
  });
});

describe("buildDiffSignals", () => {
  it("returns parentChanges separately from changed issue keys", () => {
    const log = [{
      tool: "jira_search_snapshots",
      args: { action: "diff" },
      result: {
        changed: true,
        added: [],
        removed: [],
        statusChanges: [],
        parentChanges: [{ key: "X-1", was: "PROJ-10", now: "PROJ-20" }],
        baselineTimestamp: "2026-08-20T10:00",
      },
    }];
    const signals = buildDiffSignals(log);
    expect(signals!.parentChanges).toEqual([{ key: "X-1", was: "PROJ-10", now: "PROJ-20" }]);
    expect(signals!.changedIssueKeys.has("X-1")).toBe(true);
  });
});

describe("isGroupAffectedByDiff", () => {
  it("flags epic groups when a ticket moved away or in", () => {
    const parentChanges = [{ key: "X-1", was: "PROJ-10", now: "PROJ-20" }];
    const changed = new Set(["X-1"]);

    expect(isGroupAffectedByDiff("PROJ-10", ["X-2"], changed, parentChanges)).toBe(true);
    expect(isGroupAffectedByDiff("PROJ-20", ["X-1"], changed, parentChanges)).toBe(true);
    expect(isGroupAffectedByDiff("PROJ-30", ["X-3"], changed, parentChanges)).toBe(false);
  });

  it("flags _no_epic_ when parent is added or removed", () => {
    const parentChanges = [{ key: "X-1", was: null, now: "PROJ-10" }];
    expect(isGroupAffectedByDiff("_no_epic_", [], new Set(["X-1"]), parentChanges)).toBe(true);
    expect(isGroupAffectedByDiff("PROJ-10", ["X-1"], new Set(["X-1"]), parentChanges)).toBe(true);
  });
});

// --- splitMarkdownSections ---

// [tested] Scenario: Splits assembled markdown into group sections
describe("splitMarkdownSections", () => {
  it("splits on --- separators", () => {
    const md = "## Alpha\n\nProse A.\n\n---\n\n## Beta\n\nProse B.";
    const sections = splitMarkdownSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain("## Alpha");
    expect(sections[1]).toContain("## Beta");
  });

  it("returns single section when no separator", () => {
    const md = "## Only One\n\nProse.";
    expect(splitMarkdownSections(md)).toEqual([md]);
  });
});

// --- Selective regeneration (execute-level) ---

const TEST_CACHE_REGEN = join(process.cwd(), "output", "test-selective-regen");

// [tested] Scenario: Selective regeneration — unchanged group reuses cache, changed group gets LLM call
describe("generateSprintNarrativeTool.execute (selective regeneration)", () => {
  beforeEach(() => {
    setCacheRoot(TEST_CACHE_REGEN);
    if (existsSync(TEST_CACHE_REGEN)) rmSync(TEST_CACHE_REGEN, { recursive: true });
    mkdirSync(TEST_CACHE_REGEN, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_CACHE_REGEN)) rmSync(TEST_CACHE_REGEN, { recursive: true });
  });

  const JQL = 'project = PROJ AND sprint in openSprints()';
  const THREAD = computeThread(JQL);

  it("reuses cached prose for unchanged groups and only calls LLM for changed groups", async () => {
    // Seed narrative cache with 2 groups
    saveNarrativeCache({
      thread: THREAD,
      groupBy: ["epic", "status"],
      sections: [
        {
          groupKey: "PROJ-1",
          groupLabel: "Alpha",
          issueKeys: ["X-1"],
          prose: { groupKey: "PROJ-1", done: ["Cached Alpha prose."] },
          renderedMarkdown: "## Alpha\n\nCached Alpha prose.",
        },
        {
          groupKey: "PROJ-2",
          groupLabel: "Beta",
          issueKeys: ["X-2"],
          prose: { groupKey: "PROJ-2", done: ["Cached Beta prose."] },
          renderedMarkdown: "## Beta\n\nCached Beta prose.",
        },
      ],
    });

    const groups = [
      makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] }),
      makeEpicGroup("PROJ-2", "Beta", { done: [makeIssue("X-2"), makeIssue("X-3")] }),
    ];

    const context = {
      toolCallLog: [
        {
          tool: "search_jira_issues",
          args: {},
          result: { jql: JQL, issues: [makeIssue("X-1"), makeIssue("X-2"), makeIssue("X-3")] },
        },
        {
          tool: "jira_search_snapshots",
          args: { action: "diff" },
          result: {
            changed: true,
            added: ["X-3"],
            removed: [],
            statusChanges: [],
            baselineTimestamp: "2026-08-20T10:00",
          },
        },
        {
          tool: "group_issues",
          args: {},
          result: { groups, groupBy: ["epic", "status"], dropped: 0, summary: "test" } as GroupIssuesResult,
        },
      ],
      config: { issueLinkBase: JIRA_BASE },
      llm: mockNarrativeLlm(() =>
        narrativeToolResponse({ groupKey: "PROJ-2", done: ["Fresh Beta prose."] }),
      ),
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    const narrative = (result as any).narrative as string;

    // Only 1 LLM call — for PROJ-2 (which has the new X-3 ticket)
    expect(context.llm.generateWithTools).toHaveBeenCalledTimes(1);

    // PROJ-1 uses cached prose
    expect(narrative).toContain("Cached Alpha prose.");

    // PROJ-2 uses fresh LLM prose
    expect(narrative).toContain("Fresh Beta prose.");

    // Summary reflects selective regeneration
    expect((result as any).summary).toContain("1 LLM calls");
    expect((result as any).summary).toContain("1 reused from cache");
  });

  // [tested] Scenario: Summary with selective regeneration (Reporting requirement)
  it("reports LLM call count and reused count in the summary", async () => {
    saveNarrativeCache({
      thread: THREAD,
      groupBy: ["epic", "status"],
      sections: [
        { groupKey: "PROJ-1", groupLabel: "One", issueKeys: ["X-1"], prose: { groupKey: "PROJ-1", done: ["P1 cached."] }, renderedMarkdown: "" },
        { groupKey: "PROJ-2", groupLabel: "Two", issueKeys: ["X-2"], prose: { groupKey: "PROJ-2", done: ["P2 cached."] }, renderedMarkdown: "" },
        { groupKey: "PROJ-3", groupLabel: "Three", issueKeys: ["X-3"], prose: { groupKey: "PROJ-3", done: ["P3 cached."] }, renderedMarkdown: "" },
        { groupKey: "PROJ-4", groupLabel: "Four", issueKeys: ["X-4"], prose: { groupKey: "PROJ-4", done: ["P4 cached."] }, renderedMarkdown: "" },
        { groupKey: "PROJ-5", groupLabel: "Five", issueKeys: ["X-5"], prose: { groupKey: "PROJ-5", done: ["P5 cached."] }, renderedMarkdown: "" },
      ],
    });

    const groups = [
      makeEpicGroup("PROJ-1", "One", { done: [makeIssue("X-1")] }),
      makeEpicGroup("PROJ-2", "Two", { done: [makeIssue("X-2"), makeIssue("X-6")] }),
      makeEpicGroup("PROJ-3", "Three", { done: [makeIssue("X-3")] }),
      makeEpicGroup("PROJ-4", "Four", { done: [makeIssue("X-4")] }),
      makeEpicGroup("PROJ-5", "Five", { done: [makeIssue("X-5")] }),
    ];

    let callN = 0;
    const context = {
      toolCallLog: [
        {
          tool: "search_jira_issues",
          args: {},
          result: {
            jql: JQL,
            issues: [makeIssue("X-1"), makeIssue("X-2"), makeIssue("X-3"), makeIssue("X-4"), makeIssue("X-5"), makeIssue("X-6")],
          },
        },
        {
          tool: "jira_search_snapshots",
          args: { action: "diff" },
          result: {
            changed: true,
            added: ["X-6"],
            removed: [],
            statusChanges: [{ key: "X-4", was: "To Do", now: "In Progress" }],
            parentChanges: [],
            baselineTimestamp: "2026-08-20T10:00",
          },
        },
        {
          tool: "group_issues",
          args: {},
          result: { groups, groupBy: ["epic", "status"], dropped: 0, summary: "test" } as GroupIssuesResult,
        },
      ],
      config: { issueLinkBase: JIRA_BASE },
      llm: mockNarrativeLlm(() => {
        callN++;
        return narrativeToolResponse({
          groupKey: callN === 1 ? "PROJ-2" : "PROJ-4",
          done: [`Fresh group ${callN}.`],
        });
      }),
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);

    expect(context.llm.generateWithTools).toHaveBeenCalledTimes(2);
    expect((result as any).summary).toContain("2 LLM calls");
    expect((result as any).summary).toContain("3 reused from cache");
  });

  // [tested] Scenario: Full regeneration when no cache exists
  it("regenerates all groups when no cache exists", async () => {
    const groups = [
      makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] }),
    ];

    let callN = 0;
    const context = {
      toolCallLog: [
        {
          tool: "search_jira_issues",
          args: {},
          result: { jql: JQL, issues: [makeIssue("X-1")] },
        },
        {
          tool: "group_issues",
          args: {},
          result: { groups, groupBy: ["epic", "status"], dropped: 0, summary: "test" } as GroupIssuesResult,
        },
      ],
      config: { issueLinkBase: JIRA_BASE },
      llm: mockNarrativeLlm(() => {
        callN++;
        return narrativeToolResponse({ groupKey: "PROJ-1", done: ["Fresh Alpha."] });
      }),
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    expect(context.llm.generateWithTools).toHaveBeenCalledTimes(1);
    expect((result as any).narrative).toContain("Fresh Alpha.");
  });

  // [tested] Scenario: Full regeneration when groupBy mismatch
  it("regenerates all groups when groupBy doesn't match cache", async () => {
    // Seed with epic grouping
    saveNarrativeCache({
      thread: THREAD,
      groupBy: ["epic", "status"],
      sections: [{
        groupKey: "PROJ-1", groupLabel: "Alpha", issueKeys: ["X-1"],
        prose: { groupKey: "PROJ-1", done: ["Cached."] },
        renderedMarkdown: "## Alpha\n\nCached.",
      }],
    });

    // Run with assignee grouping
    const groups = [{
      groupKey: "Alice",
      groupLabel: "Alice",
      issues: [makeIssue("X-1", { assignee: "Alice" })],
      subGroups: [{ groupKey: "done", groupLabel: "Done", issues: [makeIssue("X-1", { assignee: "Alice" })] }],
    }];

    const context = {
      toolCallLog: [
        { tool: "search_jira_issues", args: {}, result: { jql: JQL, issues: [makeIssue("X-1")] } },
        {
          tool: "jira_search_snapshots", args: { action: "diff" },
          result: { changed: true, added: ["X-1"], removed: [], statusChanges: [], baselineTimestamp: "2026-08-20T10:00" },
        },
        { tool: "group_issues", args: {}, result: { groups, groupBy: ["assignee", "status"], dropped: 0, summary: "test" } as GroupIssuesResult },
      ],
      config: { issueLinkBase: JIRA_BASE },
      llm: mockNarrativeLlm(() =>
        narrativeToolResponse({ groupKey: "Alice", done: ["Alice fresh."] }),
      ),
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    // Cache didn't match (different groupBy) → full regeneration
    expect(context.llm.generateWithTools).toHaveBeenCalledTimes(1);
    expect((result as any).narrative).toContain("Alice fresh.");
  });

  // [tested] Scenario: Ticket moves from Standalone Items to a new epic
  it("regenerates only the new epic when a ticket moves off standalone", async () => {
    const standaloneMd = "## Standalone Items\n\n**Alice**\n\nStandalone prose.";
    const alphaMd = "## Alpha ([PROJ-1](https://example.atlassian.net/browse/PROJ-1))\n\n**Bob**\n\nCached Alpha.";

    saveNarrativeCache({
      thread: THREAD,
      groupBy: ["epic", "status"],
      sections: [
        {
          groupKey: "PROJ-1",
          groupLabel: "Alpha",
          issueKeys: ["X-2"],
          prose: { groupKey: "PROJ-1", done: ["Cached Alpha."] },
          renderedMarkdown: alphaMd,
        },
        {
          groupKey: "_no_epic_",
          groupLabel: "Other Work",
          issueKeys: ["X-1"],
          prose: { groupKey: "_no_epic_", done: ["Standalone prose."] },
          renderedMarkdown: standaloneMd,
        },
      ],
    });

    const groups = [
      makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-2", { assignee: "Bob" })] }),
      makeEpicGroup("PROJ-NEW", "New Epic", { done: [makeIssue("X-1")] }),
    ];

    const context = {
      toolCallLog: [
        {
          tool: "search_jira_issues",
          args: {},
          result: { jql: JQL, issues: [makeIssue("X-1"), makeIssue("X-2")] },
        },
        {
          tool: "jira_search_snapshots",
          args: { action: "diff" },
          result: {
            changed: true,
            added: [],
            removed: [],
            statusChanges: [],
            parentChanges: [{ key: "X-1", was: null, now: "PROJ-NEW" }],
            baselineTimestamp: "2026-08-20T10:00",
          },
        },
        {
          tool: "group_issues",
          args: {},
          result: { groups, groupBy: ["epic", "status"], dropped: 0, summary: "test" } as GroupIssuesResult,
        },
      ],
      config: { issueLinkBase: JIRA_BASE },
      llm: mockNarrativeLlm(() =>
        narrativeToolResponse({ groupKey: "PROJ-NEW", done: ["Fresh new epic prose."] }),
      ),
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    const narrative = (result as any).narrative as string;

    // PROJ-1 unchanged; PROJ-NEW is new; _no_epic_ is gone (no LLM call for it)
    expect(context.llm.generateWithTools).toHaveBeenCalledTimes(1);
    expect(narrative).toContain("Cached Alpha.");
    expect(narrative).toContain("Fresh new epic prose.");
    expect(narrative).not.toContain("Standalone prose.");
  });

  // [tested] Scenario: Full override — no diff in log forces full regeneration despite cache
  it("regenerates all groups when no diff entry exists in log (full override path)", async () => {
    // Seed cache
    saveNarrativeCache({
      thread: THREAD,
      groupBy: ["epic", "status"],
      sections: [
        {
          groupKey: "PROJ-1", groupLabel: "Alpha", issueKeys: ["X-1"],
          prose: { groupKey: "PROJ-1", done: ["Cached Alpha."] },
          renderedMarkdown: "## Alpha\n\nCached Alpha.",
        },
        {
          groupKey: "PROJ-2", groupLabel: "Beta", issueKeys: ["X-2"],
          prose: { groupKey: "PROJ-2", done: ["Cached Beta."] },
          renderedMarkdown: "## Beta\n\nCached Beta.",
        },
      ],
    });

    const groups = [
      makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] }),
      makeEpicGroup("PROJ-2", "Beta", { done: [makeIssue("X-2")] }),
    ];

    // No jira_search_snapshots diff entry — simulates "full"/"regenerate" override
    const context = {
      toolCallLog: [
        { tool: "search_jira_issues", args: {}, result: { jql: JQL, issues: [makeIssue("X-1"), makeIssue("X-2")] } },
        { tool: "group_issues", args: {}, result: { groups, groupBy: ["epic", "status"], dropped: 0, summary: "test" } as GroupIssuesResult },
      ],
      config: { issueLinkBase: JIRA_BASE },
      llm: mockNarrativeLlm(() =>
        narrativeToolResponse({ groupKey: "PROJ-1", done: ["Fresh prose."] }),
      ),
    };

    await generateSprintNarrativeTool.execute!({}, context as any);

    // Both groups regenerated — cache ignored because no diff = changedKeys is null = canReuse is false
    expect(context.llm.generateWithTools).toHaveBeenCalledTimes(2);
  });
});

describe("findPriorNarrativeInLog", () => {
  it("returns prior narrative when generate was already called", () => {
    const log = [
      { tool: "group_issues", args: {}, result: {} },
      {
        tool: "generate_sprint_narrative",
        args: {},
        result: { narrative: "# Report", summary: "Sprint narrative generated — 3 LLM calls." },
      },
    ];
    expect(findPriorNarrativeInLog(log)).toEqual({
      narrative: "# Report",
      summary: "Sprint narrative generated — 3 LLM calls.",
    });
  });

  it("returns null when remove_thread was called after generate", () => {
    const log = [
      {
        tool: "generate_sprint_narrative",
        args: {},
        result: { narrative: "# Report", summary: "done" },
      },
      { tool: "jira_narrative_cache", args: { action: "remove_thread" }, result: {} },
    ];
    expect(findPriorNarrativeInLog(log)).toBeNull();
  });

  it("returns null when group_issues was called again after generate", () => {
    const log = [
      {
        tool: "generate_sprint_narrative",
        args: {},
        result: { narrative: "# Report", summary: "done" },
      },
      { tool: "group_issues", args: {}, result: {} },
    ];
    expect(findPriorNarrativeInLog(log)).toBeNull();
  });

  it("throws when prior attempt returned an error", () => {
    const log = [
      {
        tool: "generate_sprint_narrative",
        args: {},
        result: { error: "429 Rate limit reached" },
      },
    ];
    expect(() => findPriorNarrativeInLog(log)).toThrow("do not retry");
  });
});

describe("generateSprintNarrativeTool.execute (idempotent)", () => {
  it("reuses prior result when called twice in the same run", async () => {
    const groups = [makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] })];
    const priorResult = {
      narrative: "## Alpha\n\nCached from first call.",
      summary: "Sprint narrative generated — 1 LLM calls.",
    };
    const context = {
      toolCallLog: [
        {
          tool: "group_issues",
          args: {},
          result: { groups, groupBy: ["epic", "status"], dropped: 0, summary: "test" } as GroupIssuesResult,
        },
        {
          tool: "generate_sprint_narrative",
          args: {},
          result: priorResult,
        },
      ],
      config: { issueLinkBase: JIRA_BASE },
      llm: mockNarrativeLlm(() => narrativeToolResponse({ groupKey: "unused" })),
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    expect(context.llm.generateWithTools).not.toHaveBeenCalled();
    expect((result as any).narrative).toBe(priorResult.narrative);
    expect((result as any).summary).toContain("reused");
  });
});

// [tested] Scenario: Removed group (in cache, not in current grouping)
describe("generateSprintNarrativeTool.execute (removed group)", () => {
  const TEST_CACHE = join(process.cwd(), "output", "test-removed-group");
  const JQL = "project = PROJ AND sprint in openSprints()";
  const THREAD = computeThread(JQL);

  beforeEach(() => {
    setCacheRoot(TEST_CACHE);
    if (existsSync(TEST_CACHE)) rmSync(TEST_CACHE, { recursive: true });
    mkdirSync(TEST_CACHE, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_CACHE)) rmSync(TEST_CACHE, { recursive: true });
  });

  it("omits cached groups that are not in the current grouping", async () => {
    saveNarrativeCache({
      thread: THREAD,
      groupBy: ["epic", "status"],
      sections: [
        {
          groupKey: "PROJ-1",
          groupLabel: "Alpha",
          issueKeys: ["X-1"],
          prose: { groupKey: "PROJ-1", done: ["Alpha cached prose."] },
          renderedMarkdown: "## Alpha\n\nAlpha cached prose.",
        },
        {
          groupKey: "PROJ-OLD",
          groupLabel: "Removed Epic",
          issueKeys: ["X-99"],
          prose: { groupKey: "PROJ-OLD", done: ["Old cached prose."] },
          renderedMarkdown: "## Removed Epic\n\nOld cached prose.",
        },
      ],
    });

    const groups = [makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] })];
    const context = {
      toolCallLog: [
        {
          tool: "search_jira_issues",
          args: {},
          result: { jql: JQL, issues: [makeIssue("X-1")] },
        },
        {
          tool: "jira_search_snapshots",
          args: { action: "diff" },
          result: {
            changed: true,
            added: [],
            removed: ["X-99"],
            statusChanges: [],
            baselineTimestamp: "2026-08-20T10:00",
          },
        },
        {
          tool: "group_issues",
          args: {},
          result: { groups, groupBy: ["epic", "status"], dropped: 0, summary: "test" } as GroupIssuesResult,
        },
      ],
      config: { issueLinkBase: JIRA_BASE },
      llm: mockNarrativeLlm(() => narrativeToolResponse({ groupKey: "unused" })),
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    expect(context.llm.generateWithTools).not.toHaveBeenCalled();
    expect((result as any).narrative).toContain("Alpha cached prose.");
    expect((result as any).narrative).not.toContain("Removed Epic");
    expect((result as any).narrative).not.toContain("Old cached prose.");
  });
});
