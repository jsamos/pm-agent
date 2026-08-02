import { describe, it, expect } from "vitest";
import { parseJiraIssues } from "./search-issues.js";

describe("parseJiraIssues", () => {
  const baseIssue = (overrides: Record<string, unknown> = {}) => ({
    key: "TEST-1",
    fields: {
      summary: "Test issue",
      status: { name: "In Progress", statusCategory: { name: "In Progress" } },
      priority: { name: "Normal" },
      assignee: { displayName: "Alice Martin" },
      issuetype: { name: "Story" },
      parent: { key: "EPIC-1", fields: { summary: "An Epic", issuetype: { name: "Epic" } } },
      description: "A description",
      statuscategorychangedate: "2026-08-12T07:28:46.862-0700",
      ...overrides,
    },
  });

  it("parses a well-formed issue", () => {
    const result = parseJiraIssues({ issues: [baseIssue()] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      key: "TEST-1",
      summary: "Test issue",
      status: "In Progress",
      statusCategory: "In Progress",
      priority: "Normal",
      assignee: "Alice Martin",
      issueType: "Story",
      parent: { key: "EPIC-1", summary: "An Epic", issueType: "Epic" },
      description: "A description",
      sprint: null,
    });
  });

  it("handles missing fields gracefully", () => {
    const result = parseJiraIssues({
      issues: [{
        key: "TEST-2",
        fields: {
          summary: null,
          status: null,
          priority: null,
          assignee: null,
          issuetype: null,
          parent: null,
          description: null,
          statuscategorychangedate: null,
        },
      }],
    });
    expect(result[0]).toMatchObject({
      key: "TEST-2",
      summary: "",
      status: "Unknown",
      statusCategory: "Unknown",
      priority: "None",
      assignee: null,
      issueType: "Unknown",
      parent: null,
      description: null,
      sprint: null,
    });
  });

  it("extracts active sprint from sprint field array", () => {
    const result = parseJiraIssues(
      { issues: [baseIssue({
        customfield_10021: [
          { id: 100, name: "Old Sprint", state: "closed", boardId: 1, startDate: "2026-07-01", endDate: "2026-07-14" },
          { id: 200, name: "Current Sprint", state: "active", boardId: 1, startDate: "2026-08-01", endDate: "2026-08-14" },
        ],
      })] },
      { sprintFieldId: "customfield_10021" },
    );
    expect(result[0].sprint).toMatchObject({
      id: 200,
      name: "Current Sprint",
      state: "active",
      boardId: 1,
    });
  });

  it("falls back to first sprint if no active sprint", () => {
    const result = parseJiraIssues(
      { issues: [baseIssue({
        customfield_10021: [
          { id: 100, name: "Future Sprint", state: "future", boardId: 1 },
        ],
      })] },
      { sprintFieldId: "customfield_10021" },
    );
    expect(result[0].sprint).toMatchObject({ id: 100, name: "Future Sprint", state: "future" });
  });

  it("returns null sprint when field is null", () => {
    const result = parseJiraIssues(
      { issues: [baseIssue({ customfield_10021: null })] },
      { sprintFieldId: "customfield_10021" },
    );
    expect(result[0].sprint).toBeNull();
  });

  it("returns empty array for missing issues", () => {
    expect(parseJiraIssues({})).toEqual([]);
    expect(parseJiraIssues({ issues: null })).toEqual([]);
  });

  it("strips image markdown from descriptions", () => {
    const result = parseJiraIssues({
      issues: [baseIssue({ description: "Before ![alt](http://img.png) After" })],
    });
    expect(result[0].description).toBe("Before  After");
  });
});
