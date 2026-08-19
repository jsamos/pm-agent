import { describe, it, expect } from "vitest";
import { buildEpicJqlTool } from "./build-epic-jql.js";

const execute = (args: Record<string, unknown>) =>
  buildEpicJqlTool.execute(args, {} as never);

describe("build_epic_jql", () => {
  it("builds JQL for a single epic key", async () => {
    const result = await execute({ epicKeys: ["PROJ-100"] }) as { jql: string };
    expect(result.jql).toBe(
      "(key in (PROJ-100) OR parent in (PROJ-100)) ORDER BY issuetype ASC, status ASC"
    );
  });

  it("builds JQL for multiple epic keys", async () => {
    const result = await execute({ epicKeys: ["PROJ-100", "PROJ-200"] }) as { jql: string };
    expect(result.jql).toBe(
      "(key in (PROJ-100, PROJ-200) OR parent in (PROJ-100, PROJ-200)) ORDER BY issuetype ASC, status ASC"
    );
  });

  it("appends assignee filter when provided", async () => {
    const result = await execute({ epicKeys: ["PROJ-100"], assignee: "712020:00000000-0000-0000-0000-000000000001" }) as { jql: string };
    expect(result.jql).toBe(
      '(key in (PROJ-100) OR parent in (PROJ-100)) AND assignee = "712020:00000000-0000-0000-0000-000000000001" ORDER BY issuetype ASC, status ASC'
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

  it("appends statusCategory filter when excludeClosed is true", async () => {
    const result = await execute({ epicKeys: ["PROJ-100"], excludeClosed: true }) as { jql: string };
    expect(result.jql).toBe(
      "(key in (PROJ-100) OR parent in (PROJ-100)) AND statusCategory != Done ORDER BY issuetype ASC, status ASC"
    );
  });

  it("omits statusCategory filter when excludeClosed is false", async () => {
    const result = await execute({ epicKeys: ["PROJ-100"], excludeClosed: false }) as { jql: string };
    expect(result.jql).not.toContain("statusCategory");
  });

  it("throws when epicKeys is empty", async () => {
    await expect(execute({ epicKeys: [] })).rejects.toThrow("At least one epic key is required");
  });
});
