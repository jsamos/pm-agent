import { describe, it, expect } from "vitest";
import { assembleEpicMarkdown, generateEpicNarrativeTool, type EpicHeader } from "./generate-epic-narrative.js";
import type { ExecutionContext } from "../../lib/context.js";
import type { ToolCallEntry } from "../../lib/agent-loop.js";
import type { JiraIssue } from "./search-issues.js";

describe("assembleEpicMarkdown", () => {
  it("renders header and body markdown", () => {
    const body = [
      "## Outcome",
      "",
      "This epic delivers X.",
      "",
      "## What's Been Done",
      "",
      "Completed work paragraph.",
    ].join("\n");

    const md = assembleEpicMarkdown(body);

    expect(md).toContain("## Outcome\n\nThis epic delivers X.");
    expect(md).toContain("## What's Been Done\n\nCompleted work paragraph.");
  });

  it("renders Epic header with link when header is provided", () => {
    const header: EpicHeader = {
      key: "PROJ-100",
      summary: "Notification System",
      jiraBase: "https://example.atlassian.net/browse",
    };

    const md = assembleEpicMarkdown("## Outcome\n\nDelivers notifications.", header);
    expect(md).toContain(
      "**Epic:** [PROJ-100 — Notification System](https://example.atlassian.net/browse/PROJ-100)",
    );
    expect(md).not.toContain("# Notification System");
    expect(md).not.toContain("Assignee");
  });

  it("includes assignee line when header has assignee", () => {
    const header: EpicHeader = {
      key: "PROJ-200",
      summary: "Data Pipeline",
      jiraBase: "https://example.atlassian.net/browse",
      assignee: "Alice Martin",
    };

    const md = assembleEpicMarkdown("## Unlock\n\nOverview.", header);
    expect(md).toContain(
      "**Epic:** [PROJ-200 — Data Pipeline](https://example.atlassian.net/browse/PROJ-200)",
    );
    expect(md).toContain("**Assignee:** Alice Martin");
    expect(md).toMatch(/\*\*Epic:\*\*.*\n\*\*Assignee:\*\* Alice Martin\n---\n## Unlock/);
  });

  it("returns empty string when nothing to render", () => {
    expect(assembleEpicMarkdown("")).toBe("");
  });

  it("separates header and body with a horizontal rule", () => {
    const header: EpicHeader = {
      key: "PROJ-100",
      summary: "Notification System",
      jiraBase: "https://example.atlassian.net/browse",
    };

    const md = assembleEpicMarkdown("## Outcome\n\nOverview.", header);
    expect(md).toContain("---\n## Outcome");
  });
});

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
  const response = { content: llmResponse, toolCalls: [], finishReason: "stop" as const };
  return {
    toolCallLog,
    config: { issueLinkBase: "https://example.atlassian.net/browse" },
    llm: {
      generate: async () => response,
      generateWithTools: async () => response,
    },
    meta: { attempt: 1, workflowName: "test", stepName: "test" },
  } as unknown as ExecutionContext;
}

const MOCK_LLM_MARKDOWN = [
  "## Outcome",
  "",
  "This epic delivers a notification system.",
  "",
  "## What's Been Done",
  "",
  "Users receive email alerts. ([PROJ-101](https://example.atlassian.net/browse/PROJ-101) · Alice Martin · Done)",
  "",
  "## What's In Motion",
  "",
  "Push notifications are being built ([PROJ-102](https://example.atlassian.net/browse/PROJ-102) · Alice Martin · In Progress).",
  "",
  "## What's Not Started",
  "",
  "SMS integration is planned ([PROJ-103](https://example.atlassian.net/browse/PROJ-103) · Bob Chen · To Do).",
].join("\n");

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

    const ctx = mockContext(log, MOCK_LLM_MARKDOWN);
    const result = await generateEpicNarrativeTool.execute({}, ctx) as { narrative: string; summary: string };

    expect(result.narrative).toContain(
      "**Epic:** [PROJ-100 — Notification System](https://example.atlassian.net/browse/PROJ-100)",
    );
    expect(result.narrative).toContain("## Outcome");
    expect(result.narrative).toContain("## What's Been Done");
    expect(result.narrative).toContain("## What's In Motion");
    expect(result.narrative).toContain("## What's Not Started");
    expect(result.summary).toContain("1 done");
    expect(result.summary).toContain("1 in progress");
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

    const llmResp = [
      "## Unlock",
      "",
      "Enables data processing.",
      "",
      "## What's In Motion",
      "",
      "Pipeline work in progress ([PROJ-101](url) · Alice Martin · In Progress).",
    ].join("\n");

    const ctx = mockContext(log, llmResp);
    const result = await generateEpicNarrativeTool.execute({}, ctx) as { narrative: string };

    expect(result.narrative).toContain(
      "**Epic:** [PROJ-100 — Data Pipeline](https://example.atlassian.net/browse/PROJ-100)",
    );
    expect(result.narrative).toContain("**Assignee:** Alice Martin");
    expect(result.narrative).toContain("## Unlock");
  });

  it("throws when group_issues is missing from log", async () => {
    const log: ToolCallEntry[] = [
      { tool: "search_jira_issues", args: {}, result: { issues: [] } },
    ];
    const ctx = mockContext(log, "");

    await expect(generateEpicNarrativeTool.execute({}, ctx)).rejects.toThrow("group_issues");
  });
});
