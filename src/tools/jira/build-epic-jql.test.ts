import { describe, it, expect } from "vitest";
import { buildEpicJqlTool } from "./build-epic-jql.js";

const execute = (args: Record<string, unknown>) =>
  buildEpicJqlTool.execute(args, {} as never);

describe("build_epic_jql", () => {
  it("builds JQL for a single epic key", async () => {
    const result = await execute({ epicKeys: ["PROJ-100"] }) as { jql: string };
    expect(result.jql).toBe(
      "(key in (PROJ-100) OR (parent in (PROJ-100) AND status != Closed)) ORDER BY issuetype ASC, status ASC"
    );
  });

  it("builds JQL for multiple epic keys", async () => {
    const result = await execute({ epicKeys: ["PROJ-100", "PROJ-200"] }) as { jql: string };
    expect(result.jql).toBe(
      "(key in (PROJ-100, PROJ-200) OR (parent in (PROJ-100, PROJ-200) AND status != Closed)) ORDER BY issuetype ASC, status ASC"
    );
  });

  it("applies assignee filter to children only, not the epic itself", async () => {
    const result = await execute({ epicKeys: ["PROJ-100"], assignee: "712020:00000000-0000-0000-0000-000000000001" }) as { jql: string };
    expect(result.jql).toBe(
      'key in (PROJ-100) OR (parent in (PROJ-100) AND status != Closed AND assignee = "712020:00000000-0000-0000-0000-000000000001") ORDER BY issuetype ASC, status ASC'
    );
  });

  it("reports assigneeFiltered flag", async () => {
    const noFilter = await execute({ epicKeys: ["X-1"] }) as { assigneeFiltered: boolean };
    expect(noFilter.assigneeFiltered).toBe(false);

    const withFilter = await execute({ epicKeys: ["X-1"], assignee: "712020:00000000-0000-0000-0000-000000000002" }) as { assigneeFiltered: boolean };
    expect(withFilter.assigneeFiltered).toBe(true);
  });

  it("rejects display names as assignee", async () => {
    await expect(execute({ epicKeys: ["X-1"], assignee: "Alice" }))
      .rejects.toThrow("looks like a display name");
  });

  it("applies statusCategories to children only, not the epic itself", async () => {
    const result = await execute({ epicKeys: ["PROJ-100"], statusCategories: ["In Progress"] }) as { jql: string };
    expect(result.jql).toBe(
      'key in (PROJ-100) OR (parent in (PROJ-100) AND status != Closed AND statusCategory in ("In Progress")) ORDER BY issuetype ASC, status ASC'
    );
  });

  it("supports multiple statusCategories on children", async () => {
    const result = await execute({ epicKeys: ["PROJ-100"], statusCategories: ["In Progress", "To Do"] }) as { jql: string };
    expect(result.jql).toBe(
      'key in (PROJ-100) OR (parent in (PROJ-100) AND status != Closed AND statusCategory in ("In Progress", "To Do")) ORDER BY issuetype ASC, status ASC'
    );
  });

  it("combines assignee and statusCategories on children", async () => {
    const result = await execute({
      epicKeys: ["PROJ-100"],
      assignee: "712020:00000000-0000-0000-0000-000000000001",
      statusCategories: ["To Do"],
    }) as { jql: string };
    expect(result.jql).toBe(
      'key in (PROJ-100) OR (parent in (PROJ-100) AND status != Closed AND assignee = "712020:00000000-0000-0000-0000-000000000001" AND statusCategory in ("To Do")) ORDER BY issuetype ASC, status ASC'
    );
  });

  it("always excludes Closed children", async () => {
    const result = await execute({ epicKeys: ["PROJ-100"] }) as { jql: string };
    expect(result.jql).toContain("status != Closed");
    expect(result.jql).toContain("(parent in (PROJ-100) AND status != Closed)");
  });

  it("omits statusCategory filter when statusCategories is empty", async () => {
    const result = await execute({ epicKeys: ["PROJ-100"], statusCategories: [] }) as { jql: string };
    expect(result.jql).not.toContain("statusCategory");
    expect(result.jql).toContain("status != Closed");
  });

  it("omits statusCategory filter when statusCategories is omitted", async () => {
    const result = await execute({ epicKeys: ["PROJ-100"] }) as { jql: string };
    expect(result.jql).not.toContain("statusCategory");
    expect(result.jql).toContain("status != Closed");
  });

  it("throws when epicKeys is empty", async () => {
    await expect(execute({ epicKeys: [] })).rejects.toThrow("At least one epic key is required");
  });
});
