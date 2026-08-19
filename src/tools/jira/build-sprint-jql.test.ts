import { describe, it, expect } from "vitest";
import { buildSprintJqlTool } from "./build-sprint-jql.js";

function execute(args: Record<string, unknown>, config: Record<string, unknown> = { projects: ["PROJ", "WORK"] }) {
  return buildSprintJqlTool.execute(args, { config } as never);
}

describe("build_sprint_jql", () => {
  it("builds JQL with multiple projects and assignees", async () => {
    const result = await execute({ assignees: ["acc-1", "acc-2"] }) as { jql: string };
    expect(result.jql).toBe(
      'project in (PROJ, WORK) AND sprint in openSprints() AND assignee in ("acc-1", "acc-2") ORDER BY status ASC'
    );
  });

  it("uses = instead of in for a single project", async () => {
    const result = await execute({ assignees: ["acc-1"] }, { projects: ["SOLO"] }) as { jql: string };
    expect(result.jql).toBe(
      'project = SOLO AND sprint in openSprints() AND assignee in ("acc-1") ORDER BY status ASC'
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

  it("appends statusCategory filter when excludeClosed is true", async () => {
    const result = await execute({ assignees: ["acc-1"], excludeClosed: true }) as { jql: string };
    expect(result.jql).toBe(
      'project in (PROJ, WORK) AND sprint in openSprints() AND assignee in ("acc-1") AND statusCategory != Done ORDER BY status ASC'
    );
  });

  it("omits statusCategory filter when excludeClosed is false", async () => {
    const result = await execute({ assignees: ["acc-1"], excludeClosed: false }) as { jql: string };
    expect(result.jql).not.toContain("statusCategory");
  });
});
