import { describe, it, expect } from "vitest";
import type { RosterEntry } from "../tools/roster/types.js";
import type { JiraIssue } from "../tools/jira/search-issues.js";
import type { GroupIssuesResult, IssueGroup } from "../tools/jira/group-issues.js";
import { applyQaQueueRebucket } from "./sprint-qa-queue.js";
import { flattenToEpicUnits } from "../tools/jira/generate-sprint-narrative.js";
import { buildQaLanguageHints } from "./roster-roles.js";

const roster: RosterEntry[] = [
  {
    name: "Alice",
    shortName: "Alice",
    accountId: "acc-alice",
    displayName: "Alice Martin",
  },
  {
    name: "Bob",
    shortName: "Bob",
    accountId: "acc-bob",
    displayName: "Bob Chen",
    roles: ["qa"],
  },
  {
    name: "Carol",
    shortName: "Carol",
    accountId: "acc-carol",
    displayName: "Carol Diaz",
    roles: ["qa"],
  },
];

function makeIssue(key: string, overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key,
    summary: `Summary for ${key}`,
    status: "In Progress",
    statusCategory: "In Progress",
    statusCategoryChangedDate: null,
    priority: "Medium",
    assignee: "Alice Martin",
    assigneeAccountId: "acc-alice",
    parent: { key: "EPIC-1", summary: "Platform Epic", issueType: "Epic" },
    issueType: "Story",
    description: null,
    sprint: null,
    ...overrides,
  };
}

function make3LevelGrouped(assigneeGroups: IssueGroup[]): GroupIssuesResult {
  return {
    groups: assigneeGroups,
    groupBy: ["assignee", "status", "epic"],
    total: 0,
    dropped: 0,
    summary: "test",
  };
}

function assigneeWithStatuses(
  assigneeKey: string,
  assigneeLabel: string,
  statuses: {
    inProgress?: JiraIssue[];
    notStarted?: JiraIssue[];
    done?: JiraIssue[];
  },
): IssueGroup {
  const all = [
    ...(statuses.done ?? []),
    ...(statuses.inProgress ?? []),
    ...(statuses.notStarted ?? []),
  ];
  const subGroups: IssueGroup[] = [];

  for (const [statusKey, label, issues] of [
    ["done", "Done", statuses.done],
    ["in_progress", "In Progress", statuses.inProgress],
    ["not_started", "Not Started", statuses.notStarted],
  ] as const) {
    if (!issues?.length) continue;
    const byEpic = new Map<string, JiraIssue[]>();
    for (const issue of issues) {
      const epicKey =
        issue.parent?.issueType === "Epic" ? issue.parent.key : "_no_epic_";
      if (!byEpic.has(epicKey)) byEpic.set(epicKey, []);
      byEpic.get(epicKey)!.push(issue);
    }
    subGroups.push({
      groupKey: statusKey,
      groupLabel: label,
      issues: [...issues],
      subGroups: [...byEpic.entries()].map(([epicKey, epicIssues]) => ({
        groupKey: epicKey,
        groupLabel: epicKey === "_no_epic_" ? "Other Work" : epicIssues[0].parent!.summary,
        issues: epicIssues,
      })),
    });
  }

  return { groupKey: assigneeKey, groupLabel: assigneeLabel, issues: all, subGroups };
}

describe("applyQaQueueRebucket", () => {
  // Scenario: Epic-grouped sprint narrative
  it("leaves epic-first grouping unchanged", () => {
    const grouped: GroupIssuesResult = {
      groups: [],
      groupBy: ["epic", "status"],
      total: 0,
      dropped: 0,
      summary: "test",
    };
    expect(applyQaQueueRebucket(grouped, roster)).toBe(grouped);
  });

  it("returns unchanged when roster has no QA engineers", () => {
    const aliceQa = makeIssue("PROJ-100", { status: "QA", statusCategory: "In Progress" });
    const grouped = make3LevelGrouped([
      assigneeWithStatuses("Alice Martin", "Alice Martin", { inProgress: [aliceQa] }),
    ]);
    const devOnlyRoster = [roster[0]];
    expect(applyQaQueueRebucket(grouped, devOnlyRoster)).toBe(grouped);
  });

  // Scenario: Dev-assigned QA ticket + Removed from developer In Motion + Queue item under QA engineer
  it("moves dev-assigned QA tickets to QA engineer Not Started and removes from developer In Motion", () => {
    const aliceQa = makeIssue("PROJ-100", { status: "QA", statusCategory: "In Progress" });
    const grouped = make3LevelGrouped([
      assigneeWithStatuses("Alice Martin", "Alice Martin", { inProgress: [aliceQa] }),
      assigneeWithStatuses("Bob Chen", "Bob Chen", {}),
    ]);

    const result = applyQaQueueRebucket(grouped, roster);
    const alice = result.groups.find((g) => g.groupKey === "Alice Martin")!;
    const bob = result.groups.find((g) => g.groupKey === "Bob Chen")!;

    expect(getInProgressKeys(alice)).not.toContain("PROJ-100");
    expect(getNotStartedKeys(bob)).toContain("PROJ-100");
  });

  // Scenario: QA engineer assigned QA ticket
  it("keeps QA-assigned QA tickets in QA engineer In Motion", () => {
    const bobQa = makeIssue("PROJ-200", {
      assignee: "Bob Chen",
      status: "QA",
      statusCategory: "In Progress",
    });
    const grouped = make3LevelGrouped([
      assigneeWithStatuses("Bob Chen", "Bob Chen", { inProgress: [bobQa] }),
    ]);

    const result = applyQaQueueRebucket(grouped, roster);
    const bob = result.groups.find((g) => g.groupKey === "Bob Chen")!;

    expect(getInProgressKeys(bob)).toContain("PROJ-200");
    expect(getNotStartedKeys(bob)).not.toContain("PROJ-200");
  });

  // Scenario: Non-QA status
  it("does not move non-QA status tickets", () => {
    const inReview = makeIssue("PROJ-300", { status: "In Review", statusCategory: "In Progress" });
    const grouped = make3LevelGrouped([
      assigneeWithStatuses("Alice Martin", "Alice Martin", { inProgress: [inReview] }),
    ]);

    const result = applyQaQueueRebucket(grouped, roster);
    const alice = result.groups.find((g) => g.groupKey === "Alice Martin")!;

    expect(getInProgressKeys(alice)).toContain("PROJ-300");
  });

  // Scenario: QA engineer with queue only
  it("creates QA engineer outer group when they only have queue items", () => {
    const aliceQa = makeIssue("PROJ-100", { status: "QA", statusCategory: "In Progress" });
    const grouped = make3LevelGrouped([
      assigneeWithStatuses("Alice Martin", "Alice Martin", { inProgress: [aliceQa] }),
    ]);

    const result = applyQaQueueRebucket(grouped, roster);
    expect(result.groups.some((g) => g.groupKey === "Bob Chen")).toBe(true);
    const bob = result.groups.find((g) => g.groupKey === "Bob Chen")!;
    expect(getNotStartedKeys(bob)).toContain("PROJ-100");
  });

  // Scenario: Queue item epic placement
  it("places queue items under the correct epic sub-group", () => {
    const aliceQa = makeIssue("PROJ-100", {
      status: "QA",
      statusCategory: "In Progress",
      parent: { key: "EPIC-1", summary: "Platform Epic", issueType: "Epic" },
    });
    const grouped = make3LevelGrouped([
      assigneeWithStatuses("Alice Martin", "Alice Martin", { inProgress: [aliceQa] }),
    ]);

    const result = applyQaQueueRebucket(grouped, roster);
    const bob = result.groups.find((g) => g.groupKey === "Bob Chen")!;
    const notStarted = bob.subGroups!.find((s) => s.groupKey === "not_started")!;
    const epicSub = notStarted.subGroups!.find((s) => s.groupKey === "EPIC-1")!;

    expect(epicSub.issues.map((i) => i.key)).toContain("PROJ-100");
  });

  // Scenario: Shared queue across QA engineers
  it("adds the full queue to each QA engineer section", () => {
    const aliceQa = makeIssue("PROJ-100", { status: "QA", statusCategory: "In Progress" });
    const grouped = make3LevelGrouped([
      assigneeWithStatuses("Alice Martin", "Alice Martin", { inProgress: [aliceQa] }),
    ]);

    const result = applyQaQueueRebucket(grouped, roster);
    expect(getNotStartedKeys(result.groups.find((g) => g.groupKey === "Bob Chen")!)).toContain(
      "PROJ-100",
    );
    expect(getNotStartedKeys(result.groups.find((g) => g.groupKey === "Carol Diaz")!)).toContain(
      "PROJ-100",
    );
  });

  // Scenario: group_issues output preserved in log
  it("does not mutate the input grouped result", () => {
    const aliceQa = makeIssue("PROJ-100", { status: "QA", statusCategory: "In Progress" });
    const grouped = make3LevelGrouped([
      assigneeWithStatuses("Alice Martin", "Alice Martin", { inProgress: [aliceQa] }),
    ]);
    const snapshot = JSON.stringify(grouped);

    applyQaQueueRebucket(grouped, roster);

    expect(JSON.stringify(grouped)).toBe(snapshot);
  });

  it("flattenToEpicUnits reflects rebucketed Not Started queue on QA assignee", () => {
    const aliceQa = makeIssue("PROJ-100", { status: "QA", statusCategory: "In Progress" });
    const grouped = make3LevelGrouped([
      assigneeWithStatuses("Alice Martin", "Alice Martin", { inProgress: [aliceQa] }),
    ]);

    const rebucketed = applyQaQueueRebucket(grouped, roster);
    const units = flattenToEpicUnits(rebucketed);
    const bobUnit = units.find((u) => u.assigneeKey === "Bob Chen" && u.epicKey === "EPIC-1");

    expect(bobUnit).toBeDefined();
    expect(bobUnit!.notStarted.map((i) => i.key)).toContain("PROJ-100");
    expect(bobUnit!.inProgress).toHaveLength(0);
  });
});

describe("buildQaLanguageHints with rebucketed queue items", () => {
  // Scenario: Queue item hints use ticket assignee
  it("classifies queue items by ticket assignee not section owner", () => {
    const queueItem = makeIssue("PROJ-100", {
      assignee: "Alice Martin",
      status: "QA",
      statusCategory: "In Progress",
    });
    const hints = buildQaLanguageHints([queueItem], roster)!;
    expect(hints).toContain("PROJ-100 · Alice Martin · QA → awaiting QA");
  });
});

function getInProgressKeys(assigneeGroup: IssueGroup): string[] {
  const sub = assigneeGroup.subGroups?.find((s) => s.groupKey === "in_progress");
  if (!sub) return [];
  if (sub.subGroups?.length) return sub.subGroups.flatMap((e) => e.issues.map((i) => i.key));
  return sub.issues.map((i) => i.key);
}

function getNotStartedKeys(assigneeGroup: IssueGroup): string[] {
  const sub = assigneeGroup.subGroups?.find((s) => s.groupKey === "not_started");
  if (!sub) return [];
  if (sub.subGroups?.length) return sub.subGroups.flatMap((e) => e.issues.map((i) => i.key));
  return sub.issues.map((i) => i.key);
}
