import { describe, it, expect } from "vitest";
import type { JiraIssue } from "../tools/jira/search-issues.js";
import { buildBugStabilizationHints, hasBugIssues } from "./narrative-bugs.js";

function makeIssue(overrides: Partial<JiraIssue> & { key: string }): JiraIssue {
  return {
    summary: "Test",
    status: "Done",
    statusCategory: "Done",
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

describe("hasBugIssues", () => {
  it("returns false when no Bug issues", () => {
    expect(hasBugIssues([makeIssue({ key: "X-1" })])).toBe(false);
  });

  it("returns true when a Bug is present", () => {
    expect(hasBugIssues([makeIssue({ key: "X-1", issueType: "Bug" })])).toBe(true);
  });
});

describe("buildBugStabilizationHints", () => {
  it("returns null when no Bug issues", () => {
    expect(buildBugStabilizationHints([makeIssue({ key: "X-1" })])).toBeNull();
  });

  it("returns stabilization block listing Bug keys", () => {
    const hints = buildBugStabilizationHints([
      makeIssue({ key: "X-1", issueType: "Story" }),
      makeIssue({ key: "X-2", issueType: "Bug" }),
      makeIssue({ key: "X-3", issueType: "Bug" }),
    ])!;

    expect(hints).toContain("BUG STABILIZATION");
    expect(hints).toContain("Bug tickets in this batch: X-2, X-3");
    expect(hints).toContain("Stabilization paragraph");
    expect(hints).toContain("Acceptance Criteria");
  });
});

describe("appendMarkdownInstructions with bugs", () => {
  it("includes bug hints when issues include Bug type", async () => {
    const { appendMarkdownInstructions } = await import("./narrative-markdown.js");
    const issues = [
      makeIssue({ key: "X-1" }),
      makeIssue({ key: "X-2", issueType: "Bug" }),
    ];
    const result = appendMarkdownInstructions("Base message", { done: 2, inProgress: 0, notStarted: 0 }, issues);
    expect(result).toContain("Base message");
    expect(result).toContain("BUG STABILIZATION");
    expect(result).toContain("X-2");
    expect(result).toContain("### What's Been Done");
  });

  it("omits bug hints when no Bug issues", async () => {
    const { appendMarkdownInstructions } = await import("./narrative-markdown.js");
    const issues = [makeIssue({ key: "X-1" })];
    const result = appendMarkdownInstructions("Base message", { done: 1, inProgress: 0, notStarted: 0 }, issues);
    expect(result).not.toContain("BUG STABILIZATION");
  });
});
