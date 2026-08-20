import { describe, it, expect } from "vitest";
import { assembleEpicMarkdown, generateEpicNarrativeTool, type EpicNarrativeParsed, type EpicHeader } from "./generate-epic-narrative.js";
import type { ExecutionContext } from "../../lib/context.js";
import type { ToolCallEntry } from "../../lib/agent-loop.js";
import type { JiraIssue } from "./search-issues.js";

describe("assembleEpicMarkdown", () => {
  it("renders all sections when data and prose are present", () => {
    const parsed: EpicNarrativeParsed = {
      sectionType: "outcome",
      section: "This epic delivers X.",
      done: ["Completed work paragraph."],
      inMotion: ["Active work paragraph."],
      notStarted: ["Pending work paragraph."],
    };

    const md = assembleEpicMarkdown(parsed, { done: 3, inMotion: 2, notStarted: 1 });

    expect(md).toContain("## Outcome\n\nThis epic delivers X.");
    expect(md).toContain("## What's Been Done\n\nCompleted work paragraph.");
    expect(md).toContain("## What's In Motion\n\nActive work paragraph.");
    expect(md).toContain("## What's Not Started\n\nPending work paragraph.");
  });

  it("uses Unlock heading when sectionType is unlock", () => {
    const parsed: EpicNarrativeParsed = {
      sectionType: "unlock",
      section: "Technical capability.",
    };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 0, notStarted: 0 });
    expect(md).toContain("## Unlock\n\nTechnical capability.");
  });

  it("defaults to Outcome heading for unknown sectionType", () => {
    const parsed: EpicNarrativeParsed = {
      sectionType: "something_else",
      section: "Description.",
    };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 0, notStarted: 0 });
    expect(md).toContain("## Outcome\n\nDescription.");
  });

  it("omits done section when no done issues exist", () => {
    const parsed: EpicNarrativeParsed = {
      done: ["This should not appear."],
      inMotion: ["Active work."],
    };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 2, notStarted: 0 });
    expect(md).not.toContain("What's Been Done");
    expect(md).toContain("What's In Motion");
  });

  it("omits inMotion section when no in-progress issues exist", () => {
    const parsed: EpicNarrativeParsed = {
      done: ["Done work."],
      inMotion: ["This should not appear."],
    };

    const md = assembleEpicMarkdown(parsed, { done: 5, inMotion: 0, notStarted: 0 });
    expect(md).toContain("What's Been Done");
    expect(md).not.toContain("What's In Motion");
  });

  it("omits section when LLM returns empty array", () => {
    const parsed: EpicNarrativeParsed = {
      done: [],
      inMotion: ["Active."],
    };

    const md = assembleEpicMarkdown(parsed, { done: 3, inMotion: 1, notStarted: 0 });
    expect(md).not.toContain("What's Been Done");
    expect(md).toContain("What's In Motion");
  });

  it("joins multiple paragraphs with double newlines", () => {
    const parsed: EpicNarrativeParsed = {
      done: ["First paragraph.", "Second paragraph."],
    };

    const md = assembleEpicMarkdown(parsed, { done: 5, inMotion: 0, notStarted: 0 });
    expect(md).toContain("First paragraph.\n\nSecond paragraph.");
  });

  it("returns empty string when nothing to render", () => {
    const md = assembleEpicMarkdown({}, { done: 0, inMotion: 0, notStarted: 0 });
    expect(md).toBe("");
  });

  it("separates sections with horizontal rules", () => {
    const parsed: EpicNarrativeParsed = {
      sectionType: "outcome",
      section: "Overview.",
      done: ["Done."],
    };

    const md = assembleEpicMarkdown(parsed, { done: 1, inMotion: 0, notStarted: 0 });
    expect(md).toContain("---");
    const parts = md.split("\n\n---\n\n");
    expect(parts).toHaveLength(2);
  });

  it("renders H1 header with epic link when header is provided", () => {
    const header: EpicHeader = {
      key: "PROJ-100",
      summary: "Notification System",
      jiraBase: "https://example.atlassian.net/browse",
    };
    const parsed: EpicNarrativeParsed = {
      sectionType: "outcome",
      section: "Delivers notifications.",
    };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 0, notStarted: 0 }, header);
    expect(md).toContain("# Notification System");
    expect(md).toContain("[PROJ-100](https://example.atlassian.net/browse/PROJ-100)");
    expect(md).not.toContain("Assignee");
  });

  it("includes assignee line when header has assignee", () => {
    const header: EpicHeader = {
      key: "PROJ-200",
      summary: "Data Pipeline",
      jiraBase: "https://example.atlassian.net/browse",
      assignee: "Alice Martin",
    };
    const parsed: EpicNarrativeParsed = { section: "Overview." };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 0, notStarted: 0 }, header);
    expect(md).toContain("# Data Pipeline");
    expect(md).toContain("[PROJ-200]");
    expect(md).toContain("**Assignee:** Alice Martin");
  });

  it("omits assignee line when assignee is null", () => {
    const header: EpicHeader = {
      key: "PROJ-300",
      summary: "Search Feature",
      jiraBase: "https://example.atlassian.net/browse",
      assignee: null,
    };
    const parsed: EpicNarrativeParsed = { section: "Overview." };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 0, notStarted: 0 }, header);
    expect(md).toContain("# Search Feature");
    expect(md).not.toContain("Assignee");
  });

  it("renders without header when header is omitted", () => {
    const parsed: EpicNarrativeParsed = {
      sectionType: "outcome",
      section: "Overview.",
    };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 0, notStarted: 0 });
    expect(md).not.toMatch(/^# /m);
    expect(md).toContain("## Outcome");
  });
});

// --- Execute-level tests with mocked LLM ---

function makeIssue(overrides: Partial<JiraIssue> & { key: string }): JiraIssue {
  return {
    summary: "Test issue",
    status: "In Progress",
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

function mockContext(toolCallLog: ToolCallEntry[], llmResponse: string): ExecutionContext {
  return {
    toolCallLog,
    config: { issueLinkBase: "https://example.atlassian.net/browse" },
    llm: {
      generate: async () => ({ content: llmResponse }),
    },
    meta: { attempt: 1, workflowName: "test", stepName: "test" },
  } as unknown as ExecutionContext;
}

const MOCK_LLM_RESPONSE = JSON.stringify({
  sectionType: "outcome",
  section: "This epic delivers a notification system.",
  done: ["Users receive email alerts."],
  inMotion: ["Push notifications are being built ([PROJ-102](https://example.atlassian.net/browse/PROJ-102) · Alice Martin · In Progress)."],
  notStarted: ["SMS integration is planned ([PROJ-103](https://example.atlassian.net/browse/PROJ-103) · Bob Chen · To Do)."],
});

describe("generateEpicNarrativeTool.execute", () => {
  it("produces narrative from single-level status grouping", async () => {
    const issues = [
      makeIssue({ key: "PROJ-100", summary: "Notification System", issueType: "Epic", status: "In Progress" }),
      makeIssue({ key: "PROJ-101", status: "Done", statusCategory: "Done" }),
      makeIssue({ key: "PROJ-102", status: "In Progress" }),
      makeIssue({ key: "PROJ-103", status: "To Do", statusCategory: "To Do", assignee: "Bob Chen" }),
    ];

    const log: ToolCallEntry[] = [
      { tool: "search_jira_issues", args: {}, result: { issues } },
      {
        tool: "group_issues", args: { groupBy: ["status"] }, result: {
          groupBy: ["status"],
          groups: [
            { groupKey: "done", groupLabel: "Done", issues: [issues[1]] },
            { groupKey: "in_progress", groupLabel: "In Progress", issues: [issues[2]] },
            { groupKey: "not_started", groupLabel: "Not Started", issues: [issues[3]] },
          ],
        },
      },
    ];

    const ctx = mockContext(log, MOCK_LLM_RESPONSE);
    const result = await generateEpicNarrativeTool.execute({}, ctx) as { narrative: string; summary: string };

    expect(result.narrative).toContain("# Notification System");
    expect(result.narrative).toContain("[PROJ-100]");
    expect(result.narrative).toContain("## Outcome");
    expect(result.narrative).toContain("## What's Been Done");
    expect(result.narrative).toContain("## What's In Motion");
    expect(result.narrative).toContain("## What's Not Started");
    expect(result.summary).toContain("1 done");
    expect(result.summary).toContain("1 in motion");
    expect(result.summary).toContain("1 not started");
  });

  it("includes assignee when resolve_assignees and build_epic_jql are in log", async () => {
    const issues = [
      makeIssue({ key: "PROJ-100", summary: "Data Pipeline", issueType: "Epic", status: "In Progress" }),
      makeIssue({ key: "PROJ-101", status: "In Progress" }),
    ];

    const log: ToolCallEntry[] = [
      { tool: "resolve_assignees", args: {}, result: { resolved: [{ name: "Alice Martin" }] } },
      { tool: "build_epic_jql", args: {}, result: { assigneeFiltered: true } },
      { tool: "search_jira_issues", args: {}, result: { issues } },
      {
        tool: "group_issues", args: {}, result: {
          groupBy: ["status"],
          groups: [
            { groupKey: "in_progress", groupLabel: "In Progress", issues: [issues[1]] },
          ],
        },
      },
    ];

    const llmResp = JSON.stringify({
      sectionType: "unlock",
      section: "Enables data processing.",
      inMotion: ["Pipeline work in progress ([PROJ-101](url) · Alice Martin · In Progress)."],
    });

    const ctx = mockContext(log, llmResp);
    const result = await generateEpicNarrativeTool.execute({}, ctx) as { narrative: string };

    expect(result.narrative).toContain("# Data Pipeline");
    expect(result.narrative).toContain("**Assignee:** Alice Martin");
    expect(result.narrative).toContain("## Unlock");
  });

  it("throws when group_issues is missing from log", async () => {
    const log: ToolCallEntry[] = [
      { tool: "search_jira_issues", args: {}, result: { issues: [] } },
    ];
    const ctx = mockContext(log, "{}");

    await expect(generateEpicNarrativeTool.execute({}, ctx)).rejects.toThrow("group_issues");
  });
});
