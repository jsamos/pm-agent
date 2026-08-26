import { describe, it, expect } from "vitest";
import { loadSkillTool } from "./load-skill.js";

const dummyCtx = {} as Parameters<typeof loadSkillTool.execute>[1];

describe("load_skill", () => {
  it("loads a known skill and returns its content", async () => {
    const result = (await loadSkillTool.execute({ name: "sprint-narrative" }, dummyCtx)) as {
      skill: string;
      instructions: string;
    };

    expect(result.skill).toBe("sprint-narrative");
    expect(result.instructions).toContain("resolve_assignees");
    expect(result.instructions).toContain("generate_sprint_narrative");
  });

  it("loads each available skill without error", async () => {
    const available = ["sprint-narrative", "epic-narrative", "roster"];
    for (const name of available) {
      const result = (await loadSkillTool.execute({ name }, dummyCtx)) as {
        skill: string;
        instructions: string;
      };
      expect(result.skill).toBe(name);
      expect(result.instructions.length).toBeGreaterThan(0);
    }
  });

  it("throws on unknown skill name", async () => {
    await expect(loadSkillTool.execute({ name: "nonexistent" }, dummyCtx)).rejects.toThrow(
      /Unknown skill "nonexistent"/,
    );
  });

  it("lists available skills in tool description", () => {
    expect(loadSkillTool.description).toContain("sprint-narrative");
    expect(loadSkillTool.description).toContain("epic-narrative");
    expect(loadSkillTool.description).toContain("roster");
  });

  // [tested] Scenario: Prose regen clears cached entries (smart-update spec)
  it("sprint-narrative skill instructs remove_thread on prose regen keywords", async () => {
    const result = (await loadSkillTool.execute({ name: "sprint-narrative" }, dummyCtx)) as {
      instructions: string;
    };
    expect(result.instructions).toContain('jira_narrative_cache({ action: "remove_thread" })');
    expect(result.instructions).toContain("regenerate");
    expect(result.instructions).toContain("full rewrite");
  });
});
