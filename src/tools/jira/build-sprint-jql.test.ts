import { describe, it, expect } from "vitest";
import { buildSprintJqlTool } from "./build-sprint-jql.js";

function execute(args: Record<string, unknown>, config: Record<string, unknown> = { projects: ["PROJ", "WORK"] }) {
  return buildSprintJqlTool.execute(args, { config } as never);
}

describe("build_sprint_jql", () => {
  it("builds JQL with multiple projects and assignees", async () => {
    const result = await execute({ assignees: ["acc-1", "acc-2"] }) as { jql: string };
    expect(result.jql).toBe(
      'project in (PROJ, WORK) AND sprint in openSprints() AND assignee in ("acc-1", "acc-2") AND status != Closed ORDER BY status ASC'
    );
  });

  it("uses = instead of in for a single project", async () => {
    const result = await execute({ assignees: ["acc-1"] }, { projects: ["SOLO"] }) as { jql: string };
    expect(result.jql).toBe(
      'project = SOLO AND sprint in openSprints() AND assignee in ("acc-1") AND status != Closed ORDER BY status ASC'
    );
  });

  it("returns project list and assignee count", async () => {
    const result = await execute({ assignees: ["acc-1", "acc-2"] }) as { projects: string[]; assigneeCount: number };
    expect(result.projects).toEqual(["PROJ", "WORK"]);
    expect(result.assigneeCount).toBe(2);
  });

  it("throws when assignees is empty", async () => {
    await expect(execute({ assignees: [] })).rejects.toThrow("Assignees are required");
  });

  it("throws when no projects configured", async () => {
    await expect(execute({ assignees: ["acc-1"] }, { projects: [] })).rejects.toThrow("No projects configured");
  });

  it("filters by a single statusCategory", async () => {
    const result = await execute({ assignees: ["acc-1"], statusCategories: ["In Progress"] }) as { jql: string };
    expect(result.jql).toBe(
      'project in (PROJ, WORK) AND sprint in openSprints() AND assignee in ("acc-1") AND statusCategory in ("In Progress") AND status != Closed ORDER BY status ASC'
    );
  });

  it("filters by multiple statusCategories", async () => {
    const result = await execute({ assignees: ["acc-1"], statusCategories: ["In Progress", "To Do"] }) as { jql: string };
    expect(result.jql).toBe(
      'project in (PROJ, WORK) AND sprint in openSprints() AND assignee in ("acc-1") AND statusCategory in ("In Progress", "To Do") AND status != Closed ORDER BY status ASC'
    );
  });

  it("always excludes Closed status", async () => {
    const result = await execute({ assignees: ["acc-1"] }) as { jql: string };
    expect(result.jql).toContain("status != Closed");
  });

  it("omits statusCategory filter when statusCategories is empty", async () => {
    const result = await execute({ assignees: ["acc-1"], statusCategories: [] }) as { jql: string };
    expect(result.jql).not.toContain("statusCategory");
    expect(result.jql).toContain("status != Closed");
  });

  it("omits statusCategory filter when statusCategories is omitted", async () => {
    const result = await execute({ assignees: ["acc-1"] }) as { jql: string };
    expect(result.jql).not.toContain("statusCategory");
    expect(result.jql).toContain("status != Closed");
  });
});
