import { describe, it, expect } from "vitest";
import {
  deriveCascadePairs,
  validateRosterMembership,
  resolveWorkPageTargets,
  countOpenWork,
} from "./epic-cascade.js";
import type { DiffData } from "../tools/jira/format-diff.js";
import type { JiraIssue } from "../tools/jira/search-issues.js";
import type { RosterEntry } from "../tools/roster/types.js";

const ALICE_ID = "712020:00000000-0000-0000-0000-000000000001";
const BOB_ID = "712020:00000000-0000-0000-0000-000000000002";

function issue(
  key: string,
  overrides: Partial<JiraIssue> = {},
): JiraIssue {
  return {
    key,
    summary: `Summary ${key}`,
    status: "To Do",
    statusCategory: "To Do",
    statusCategoryChangedDate: null,
    priority: "Medium",
    assignee: "Alice",
    assigneeAccountId: ALICE_ID,
    parent: { key: "PROJ-100", summary: "Epic Alpha", issueType: "Epic" },
    issueType: "Story",
    description: null,
    sprint: null,
    ...overrides,
  };
}

function rosterEntry(overrides: Partial<RosterEntry> = {}): RosterEntry {
  return {
    name: "Alice Martin",
    shortName: "Alice",
    accountId: ALICE_ID,
    displayName: "Alice Martin",
    workPages: [
      {
        page: "https://www.notion.so/workspace/Alice-Work-abc123",
        epics: ["PROJ-100"],
      },
    ],
    ...overrides,
  };
}

describe("deriveCascadePairs", () => {
  const emptyDiff = (): DiffData => ({
    changed: true,
    added: [],
    removed: [],
    statusChanges: [],
    parentChanges: [],
    assigneeChanges: [],
    baselineTimestamp: "2026-08-17T10:00",
  });

  it("derives pair from added ticket", () => {
    const diff = { ...emptyDiff(), added: ["X-1"] };
    const fresh = [issue("X-1")];
    const { pairs, unassignedKeys } = deriveCascadePairs(diff, fresh, []);
    expect(pairs).toEqual([{ assigneeAccountId: ALICE_ID, epicKey: "PROJ-100" }]);
    expect(unassignedKeys).toEqual([]);
  });

  it("derives pair from status change", () => {
    const diff = { ...emptyDiff(), statusChanges: [{ key: "X-1", was: "To Do", now: "Done" }] };
    const fresh = [issue("X-1")];
    const { pairs } = deriveCascadePairs(diff, fresh, []);
    expect(pairs).toEqual([{ assigneeAccountId: ALICE_ID, epicKey: "PROJ-100" }]);
  });

  it("derives pair from removed ticket using baseline", () => {
    const diff = { ...emptyDiff(), removed: ["X-1"] };
    const baseline = [{ key: "X-1", assigneeAccountId: ALICE_ID, parent: { key: "PROJ-100", summary: "Epic", issueType: "Epic" } }];
    const { pairs } = deriveCascadePairs(diff, [], baseline);
    expect(pairs).toEqual([{ assigneeAccountId: ALICE_ID, epicKey: "PROJ-100" }]);
  });

  it("derives both epics from parent change", () => {
    const diff = {
      ...emptyDiff(),
      parentChanges: [{ key: "X-1", was: "PROJ-10", now: "PROJ-20" }],
    };
    const fresh = [issue("X-1", { parent: { key: "PROJ-20", summary: "Beta", issueType: "Epic" } })];
    const { pairs } = deriveCascadePairs(diff, fresh, []);
    expect(pairs).toHaveLength(2);
    expect(pairs).toContainEqual({ assigneeAccountId: ALICE_ID, epicKey: "PROJ-10" });
    expect(pairs).toContainEqual({ assigneeAccountId: ALICE_ID, epicKey: "PROJ-20" });
  });

  it("derives both assignees from assignee change", () => {
    const diff = {
      ...emptyDiff(),
      assigneeChanges: [{ key: "X-1", was: ALICE_ID, now: BOB_ID }],
    };
    const fresh = [issue("X-1")];
    const { pairs } = deriveCascadePairs(diff, fresh, []);
    expect(pairs).toHaveLength(2);
    expect(pairs).toContainEqual({ assigneeAccountId: ALICE_ID, epicKey: "PROJ-100" });
    expect(pairs).toContainEqual({ assigneeAccountId: BOB_ID, epicKey: "PROJ-100" });
  });

  it("logs unassigned instead of pairing", () => {
    const diff = { ...emptyDiff(), added: ["X-1"] };
    const fresh = [issue("X-1", { assigneeAccountId: null, assignee: null })];
    const { pairs, unassignedKeys } = deriveCascadePairs(diff, fresh, []);
    expect(pairs).toEqual([]);
    expect(unassignedKeys).toEqual(["X-1"]);
  });

  it("dedupes identical pairs", () => {
    const diff = {
      ...emptyDiff(),
      added: ["X-1", "X-2"],
      statusChanges: [{ key: "X-1", was: "To Do", now: "In Progress" }],
    };
    const fresh = [
      issue("X-1"),
      issue("X-2", { key: "X-2" }),
    ];
    const { pairs } = deriveCascadePairs(diff, fresh, []);
    expect(pairs).toHaveLength(1);
  });
});

describe("validateRosterMembership", () => {
  it("throws for unknown assignee", () => {
    const pairs = [{ assigneeAccountId: "unknown-id", epicKey: "PROJ-100" }];
    expect(() => validateRosterMembership(pairs, [rosterEntry()])).toThrow(/Unknown roster assignee/);
  });

  it("passes when all assignees are on roster", () => {
    const pairs = [{ assigneeAccountId: ALICE_ID, epicKey: "PROJ-100" }];
    expect(() => validateRosterMembership(pairs, [rosterEntry()])).not.toThrow();
  });
});

describe("resolveWorkPageTargets", () => {
  it("returns notCreated for unmapped epic", () => {
    const pairs = [{ assigneeAccountId: ALICE_ID, epicKey: "PROJ-999" }];
    const { targets, notCreated } = resolveWorkPageTargets(pairs, [rosterEntry()]);
    expect(targets).toEqual([]);
    expect(notCreated).toEqual([
      {
        assigneeAccountId: ALICE_ID,
        assigneeDisplayName: "Alice Martin",
        epicKey: "PROJ-999",
        reason: "not created",
      },
    ]);
  });

  // Scenario: All targets resolved — mapped proceed, unmapped in notCreated only
  it("returns mapped targets and notCreated when pairs are mixed", () => {
    const entry = rosterEntry({
      workPages: [{ page: "https://www.notion.so/workspace/Alice-Work-abc123", epics: ["PROJ-100"] }],
    });
    const pairs = [
      { assigneeAccountId: ALICE_ID, epicKey: "PROJ-100" },
      { assigneeAccountId: ALICE_ID, epicKey: "PROJ-999" },
    ];
    const { targets, notCreated } = resolveWorkPageTargets(pairs, [entry]);
    expect(targets).toHaveLength(1);
    expect(targets[0].epicKeys).toEqual(["PROJ-100"]);
    expect(notCreated).toEqual([
      {
        assigneeAccountId: ALICE_ID,
        assigneeDisplayName: "Alice Martin",
        epicKey: "PROJ-999",
        reason: "not created",
      },
    ]);
  });

  // Scenario: Dedupe by work page
  it("groups by work page with all epics on entry", () => {
    const entry = rosterEntry({
      workPages: [
        {
          page: "https://www.notion.so/workspace/Rollup-def456",
          epics: ["PROJ-100", "PROJ-200"],
        },
      ],
    });
    const pairs = [
      { assigneeAccountId: ALICE_ID, epicKey: "PROJ-100" },
      { assigneeAccountId: ALICE_ID, epicKey: "PROJ-200" },
    ];
    const { targets, notCreated } = resolveWorkPageTargets(pairs, [entry]);
    expect(notCreated).toEqual([]);
    expect(targets).toHaveLength(1);
    expect(targets[0].epicKeys).toEqual(["PROJ-100", "PROJ-200"]);
  });
});

describe("countOpenWork", () => {
  it("excludes epic issues", () => {
    const issues = [
      issue("PROJ-100", { issueType: "Epic", parent: null }),
      issue("X-1"),
    ];
    expect(countOpenWork(issues)).toBe(1);
  });
});
