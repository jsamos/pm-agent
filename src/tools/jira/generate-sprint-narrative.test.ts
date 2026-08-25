import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { setCacheRoot } from "../../lib/cache.js";
import {
  assembleMarkdown,
  assembleThreeLevelMarkdown,
  renderHeading,
  getSubGroupIssues,
  extractJson,
  linkifyIssueKeys,
  buildGroupMessage,
  buildChangedKeySet,
  buildDiffSignals,
  isGroupAffectedByDiff,
  splitMarkdownSections,
  flattenToEpicUnits,
  generateSprintNarrativeTool,
  type GroupNarrative,
  type AssembleResult,
  type EpicUnit,
} from "./generate-sprint-narrative.js";
import { saveNarrativeCache, computeThread } from "./narrative-cache.js";
import type { IssueGroup, GroupIssuesResult } from "./group-issues.js";
import type { JiraIssue } from "./search-issues.js";

const JIRA_BASE = "https://example.atlassian.net/browse";

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

// --- extractJson ---

describe("extractJson", () => {
  it("extracts JSON from a fenced code block", () => {
    const raw = '```json\n{"groups": []}\n```';
    expect(extractJson(raw)).toBe('{"groups": []}');
  });

  it("extracts JSON from bare text with preamble", () => {
    const raw = 'Here is the result:\n{"groups": []}';
    expect(extractJson(raw)).toBe('{"groups": []}');
  });

  it("returns trimmed text when already valid JSON", () => {
    expect(extractJson('  {"a": 1}  ')).toBe('{"a": 1}');
  });
});

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
      { groupKey: "PROJ-100", delivered: ["Onboarding is complete."] },
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
      { groupKey: "User Onboarding", delivered: ["Matched by label."] },
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
      { groupKey: "user onboarding", delivered: ["Case insensitive match."] },
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
      { groupKey: "PROJ-2", delivered: ["Zebra prose."] },
      { groupKey: "PROJ-1", delivered: ["Alpha prose."] },
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
      { groupKey: "_no_epic_", delivered: ["Standalone prose."] },
      { groupKey: "PROJ-1", delivered: ["Alpha prose."] },
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
      { groupKey: "PROJ-1", delivered: ["Alpha prose."] },
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
      { groupKey: "PROJ-1", delivered: ["Alpha."] },
      { groupKey: "PROJ-2", delivered: ["Should not appear."] },
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
        delivered: ["Done prose."],
        inProgress: ["WIP prose."],
        notStarted: ["Pending prose."],
      },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Done prose.");
    expect(md).toContain("### In Progress\n\nWIP prose.");
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
      { groupKey: " PROJ-914 ", delivered: ["Trimmed key match."] },
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
      { groupKey: "PROJ-1", delivered: ["Done."], inProgress: ["WIP."] },
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
      { groupKey: "PROJ-1", delivered: ["Done."], inProgress: ["WIP."] },
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
      { groupKey: "PROJ-1", delivered: ["Done."] },
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
      { groupKey: "Dan Torres", delivered: ["Dan delivered work."] },
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
      { groupKey: "dan torres", delivered: ["Case insensitive match."] },
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
      { groupKey: " Dan Torres ", delivered: ["Whitespace match."] },
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
      { groupKey: "Dan Torres", delivered: ["Delivered."] },
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
        delivered: ["Done prose."],
        inProgress: ["WIP prose."],
        notStarted: ["Pending prose."],
      },
    ];

    const { markdown: md } = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Done prose.");
    expect(md).toContain("### In Progress\n\nWIP prose.");
    expect(md).toContain("### Not Started\n\nPending prose.");
  });

  it("still renders assignee bold line for epic grouping", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-1", "Alpha", {
        done: [makeIssue("X-1", { assignee: "Bob" })],
      }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "PROJ-1", delivered: ["Done."] },
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
      { groupKey: "Alpha", heading: "Alpha", done: "Done.", inMotion: "Moving." },
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
      { groupKey: "Wrong Key", heading: "Wrong", done: "Done." },
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
      { groupKey: "Alpha", heading: "Alpha", done: "Done." },
      { groupKey: "Gamma", heading: "Gamma", done: "Not matching." },
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
      { groupKey: "WRONG-999 — Feature Beta", delivered: ["Shipped it."] },
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
    expect(msg).toContain("Done (1):");
    expect(msg).toContain("In Progress (1):");
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
        llm: {
          generate: vi.fn(async () => {
            callCount.n++;
            const groupIdx = callCount.n - 1;
            const key = groups[groupIdx]?.groupKey ?? "unknown";
            return {
              content: JSON.stringify({
                groupKey: key,
                delivered: [`Prose for ${key}.`],
              }),
            };
          }),
        },
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

    expect(context.llm.generate).toHaveBeenCalledTimes(3);
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
      llm: {
        generate: vi.fn(async () => {
          callN++;
          if (callN === 1) return { content: "not valid json at all" };
          return { content: JSON.stringify({ groupKey: "PROJ-2", delivered: ["Beta works."] }) };
        }),
      },
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    expect(context.llm.generate).toHaveBeenCalledTimes(2);
    expect((result as any).narrative).toContain("Beta works.");
    expect((result as any).narrative).toContain("_No narrative generated._");
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
      llm: {
        generate: vi.fn(async () => {
          callN++;
          return { content: JSON.stringify({ groupKey: "Alice Martin", delivered: ["Alice delivered."] }) };
        }),
      },
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    expect(context.llm.generate).toHaveBeenCalledTimes(1);
    expect((result as any).narrative).toContain("Alice delivered.");
  });
});

// --- flattenToEpicUnits ---

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
    proseMap.set("Alice::PROJ-50", { groupKey: "Alice::PROJ-50", delivered: ["Clean claims delivered."] });
    proseMap.set("Alice::PROJ-60", { groupKey: "Alice::PROJ-60", inProgress: ["Eligibility in progress."] });

    const result = assembleThreeLevelMarkdown(grouped, units, proseMap, JIRA_BASE);

    expect(result.markdown).toContain("## Alice");
    expect(result.markdown).toContain("**Clean Claims**");
    expect(result.markdown).toContain("Clean claims delivered.");
    expect(result.markdown).toContain("### In Progress");
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
    proseMap.set("Bob::_no_epic_", { groupKey: "Bob::_no_epic_", delivered: ["Standalone work."] });

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
          prose: { groupKey: "PROJ-1", delivered: ["Cached Alpha prose."] },
          renderedMarkdown: "## Alpha\n\nCached Alpha prose.",
        },
        {
          groupKey: "PROJ-2",
          groupLabel: "Beta",
          issueKeys: ["X-2"],
          prose: { groupKey: "PROJ-2", delivered: ["Cached Beta prose."] },
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
      llm: {
        generate: vi.fn(async () => ({
          content: JSON.stringify({ groupKey: "PROJ-2", delivered: ["Fresh Beta prose."] }),
        })),
      },
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    const narrative = (result as any).narrative as string;

    // Only 1 LLM call — for PROJ-2 (which has the new X-3 ticket)
    expect(context.llm.generate).toHaveBeenCalledTimes(1);

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
        { groupKey: "PROJ-1", groupLabel: "One", issueKeys: ["X-1"], prose: { groupKey: "PROJ-1", delivered: ["P1 cached."] }, renderedMarkdown: "" },
        { groupKey: "PROJ-2", groupLabel: "Two", issueKeys: ["X-2"], prose: { groupKey: "PROJ-2", delivered: ["P2 cached."] }, renderedMarkdown: "" },
        { groupKey: "PROJ-3", groupLabel: "Three", issueKeys: ["X-3"], prose: { groupKey: "PROJ-3", delivered: ["P3 cached."] }, renderedMarkdown: "" },
        { groupKey: "PROJ-4", groupLabel: "Four", issueKeys: ["X-4"], prose: { groupKey: "PROJ-4", delivered: ["P4 cached."] }, renderedMarkdown: "" },
        { groupKey: "PROJ-5", groupLabel: "Five", issueKeys: ["X-5"], prose: { groupKey: "PROJ-5", delivered: ["P5 cached."] }, renderedMarkdown: "" },
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
      llm: {
        generate: vi.fn(async () => {
          callN++;
          return {
            content: JSON.stringify({
              groupKey: callN === 1 ? "PROJ-2" : "PROJ-4",
              delivered: [`Fresh group ${callN}.`],
            }),
          };
        }),
      },
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);

    expect(context.llm.generate).toHaveBeenCalledTimes(2);
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
      llm: {
        generate: vi.fn(async () => {
          callN++;
          return { content: JSON.stringify({ groupKey: "PROJ-1", delivered: ["Fresh Alpha."] }) };
        }),
      },
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    expect(context.llm.generate).toHaveBeenCalledTimes(1);
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
        prose: { groupKey: "PROJ-1", delivered: ["Cached."] },
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
      llm: {
        generate: vi.fn(async () => ({
          content: JSON.stringify({ groupKey: "Alice", delivered: ["Alice fresh."] }),
        })),
      },
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    // Cache didn't match (different groupBy) → full regeneration
    expect(context.llm.generate).toHaveBeenCalledTimes(1);
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
          prose: { groupKey: "PROJ-1", delivered: ["Cached Alpha."] },
          renderedMarkdown: alphaMd,
        },
        {
          groupKey: "_no_epic_",
          groupLabel: "Other Work",
          issueKeys: ["X-1"],
          prose: { groupKey: "_no_epic_", delivered: ["Standalone prose."] },
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
      llm: {
        generate: vi.fn(async () => ({
          content: JSON.stringify({ groupKey: "PROJ-NEW", delivered: ["Fresh new epic prose."] }),
        })),
      },
    };

    const result = await generateSprintNarrativeTool.execute!({}, context as any);
    const narrative = (result as any).narrative as string;

    // PROJ-1 unchanged; PROJ-NEW is new; _no_epic_ is gone (no LLM call for it)
    expect(context.llm.generate).toHaveBeenCalledTimes(1);
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
          prose: { groupKey: "PROJ-1", delivered: ["Cached Alpha."] },
          renderedMarkdown: "## Alpha\n\nCached Alpha.",
        },
        {
          groupKey: "PROJ-2", groupLabel: "Beta", issueKeys: ["X-2"],
          prose: { groupKey: "PROJ-2", delivered: ["Cached Beta."] },
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
      llm: {
        generate: vi.fn(async (_msgs: unknown) => ({
          content: JSON.stringify({ groupKey: "PROJ-1", delivered: ["Fresh prose."] }),
        })),
      },
    };

    await generateSprintNarrativeTool.execute!({}, context as any);

    // Both groups regenerated — cache ignored because no diff = changedKeys is null = canReuse is false
    expect(context.llm.generate).toHaveBeenCalledTimes(2);
  });
});
