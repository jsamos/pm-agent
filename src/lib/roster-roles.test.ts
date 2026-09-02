import { describe, it, expect } from "vitest";
import type { RosterEntry } from "../tools/roster/types.js";
import type { JiraIssue } from "../tools/jira/search-issues.js";
import {
  assigneeHasRole,
  buildQaLanguageHints,
  isQaStatus,
  listQaEngineers,
} from "./roster-roles.js";

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
];

function makeIssue(overrides: Partial<JiraIssue> & { key: string }): JiraIssue {
  return {
    summary: "Test",
    status: "QA",
    statusCategory: "In Progress",
    statusCategoryChangedDate: null,
    priority: "Medium",
    assignee: "Alice Martin",
    parent: null,
    issueType: "Story",
    description: null,
    sprint: null,
    ...overrides,
  };
}

describe("isQaStatus", () => {
  it("matches QA case-insensitively", () => {
    expect(isQaStatus("QA")).toBe(true);
    expect(isQaStatus("qa")).toBe(true);
    expect(isQaStatus("In Progress")).toBe(false);
  });
});

describe("assigneeHasRole", () => {
  it("returns true when assignee has qa role in roster", () => {
    expect(assigneeHasRole("Bob Chen", "qa", roster)).toBe(true);
    expect(assigneeHasRole("bob chen", "qa", roster)).toBe(true);
  });

  it("returns false when assignee lacks qa role", () => {
    expect(assigneeHasRole("Alice Martin", "qa", roster)).toBe(false);
    expect(assigneeHasRole(null, "qa", roster)).toBe(false);
  });
});

describe("listQaEngineers", () => {
  it("lists display names with qa role", () => {
    expect(listQaEngineers(roster)).toEqual(["Bob Chen"]);
  });
});

describe("buildQaLanguageHints", () => {
  it("returns null when no QA-status issues", () => {
    const issues = [makeIssue({ key: "X-1", status: "In Progress" })];
    expect(buildQaLanguageHints(issues, roster)).toBeNull();
  });

  it("classifies QA issues by assignee role", () => {
    const issues = [
      makeIssue({ key: "X-1", assignee: "Alice Martin", status: "QA" }),
      makeIssue({ key: "X-2", assignee: "Bob Chen", status: "QA" }),
    ];
    const hints = buildQaLanguageHints(issues, roster)!;
    expect(hints).toContain("QA engineers on this team: Bob Chen");
    expect(hints).toContain("X-1 · Alice Martin · QA → awaiting QA");
    expect(hints).toContain("X-2 · Bob Chen · QA → active QA validation");
  });
});

describe("appendMarkdownInstructions", () => {
  it("includes QA hints when issues have QA status", async () => {
    const { appendMarkdownInstructions } = await import("./narrative-markdown.js");
    const issues = [makeIssue({ key: "X-1", assignee: "Alice Martin", status: "QA" })];
    const result = appendMarkdownInstructions("Base message", { done: 0, inProgress: 1, notStarted: 0 }, issues);
    expect(result).toContain("Base message");
    expect(result).toContain("QA STATUS LANGUAGE");
    expect(result).toContain("X-1 · Alice Martin · QA → awaiting QA");
    expect(result).toContain("### What's In Motion");
  });
});
