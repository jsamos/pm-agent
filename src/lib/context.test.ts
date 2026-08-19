import { describe, it, expect } from "vitest";
import { resolveContentRef } from "./context.js";
import type { ToolCallEntry } from "./agent-loop.js";

describe("resolveContentRef", () => {
  const log: ToolCallEntry[] = [
    { tool: "build_sprint_jql", args: {}, result: { jql: "project = PROJ", summary: "Built JQL" } },
    { tool: "generate_sprint_narrative", args: {}, result: { narrative: "# Sprint Report\n\nDone: 5 items", summary: "Generated." } },
    { tool: "search_slack_users", args: { query: "alice" }, result: { users: [{ userId: "U001" }], summary: "Found 1 user" } },
  ];

  it("finds narrative from generate_sprint_narrative", () => {
    const content = resolveContentRef(log, "generate_sprint_narrative");
    expect(content).toBe("# Sprint Report\n\nDone: 5 items");
  });

  it("returns null for a tool not in the log", () => {
    expect(resolveContentRef(log, "generate_epic_narrative")).toBeNull();
  });

  it("returns null when field doesn't exist on the result", () => {
    expect(resolveContentRef(log, "build_sprint_jql", "narrative")).toBeNull();
  });

  it("supports custom field names", () => {
    expect(resolveContentRef(log, "build_sprint_jql", "jql")).toBe("project = PROJ");
  });

  it("returns null for undefined log", () => {
    expect(resolveContentRef(undefined, "anything")).toBeNull();
  });

  it("returns the most recent invocation when tool appears multiple times", () => {
    const multiLog: ToolCallEntry[] = [
      { tool: "generate_sprint_narrative", args: {}, result: { narrative: "old report" } },
      { tool: "generate_sprint_narrative", args: {}, result: { narrative: "new report" } },
    ];
    expect(resolveContentRef(multiLog, "generate_sprint_narrative")).toBe("new report");
  });
});
