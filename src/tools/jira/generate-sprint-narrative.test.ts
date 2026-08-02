import { describe, it, expect } from "vitest";
import {
  assembleMarkdown,
  renderHeading,
  getSubGroupIssues,
  extractJson,
  linkifyIssueKeys,
  type GroupNarrative,
} from "./generate-sprint-narrative.js";
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("Done prose.");
    expect(md).toContain("### In Progress\n\nWIP prose.");
    expect(md).toContain("### Not Started\n\nPending prose.");
  });

  it("handles empty parsedGroups gracefully (all fallback)", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-1", "Alpha", { done: [makeIssue("X-1")] }),
    ]);

    const md = assembleMarkdown(grouped, [], JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).not.toContain("**");
  });

  it("linkifies bare issue keys in prose", () => {
    const grouped = makeGrouped([
      makeEpicGroup("PROJ-1", "Alpha", { inProgress: [makeIssue("WORK-100")] }),
    ]);

    const parsedGroups: GroupNarrative[] = [
      { groupKey: "PROJ-1", inProgress: ["Work is underway (WORK-100 · Alice)."] },
    ];

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
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

    const md = assembleMarkdown(grouped, parsedGroups, JIRA_BASE);
    expect(md).toContain("**Bob**");
  });

  it("handles empty parsedGroups for assignee grouping (all fallback)", () => {
    const grouped = makeAssigneeGrouped([
      makeAssigneeGroup("Alice", { done: [makeIssue("X-1", { assignee: "Alice" })] }),
    ]);

    const md = assembleMarkdown(grouped, [], JIRA_BASE);
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
