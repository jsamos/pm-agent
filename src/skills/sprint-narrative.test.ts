import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSprintNarrativeSteps, stepByNumber } from "./sprint-narrative-steps.js";
import { cascadeEpicNotionUpdatesTool } from "../tools/jira/cascade-epic-notion.js";

const SKILL_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "sprint-narrative.md");

describe("sprint-narrative skill workflow", () => {
  const skill = readFileSync(SKILL_PATH, "utf-8");
  const steps = parseSprintNarrativeSteps(skill);

  // Scenario: Changed sprint diff — cascade after sprint narrative and optional Notion
  it("schedules cascade after generate_sprint_narrative and optional Notion update", () => {
    const narrative = stepByNumber(steps, 6)!;
    const notion = stepByNumber(steps, 7)!;
    const cascade = stepByNumber(steps, 8)!;
    expect(narrative.line).toContain("generate_sprint_narrative");
    expect(notion.line).toContain("update_notion_page");
    expect(cascade.line).toContain("cascade_epic_notion_updates");
    expect(cascade.number).toBeGreaterThan(narrative.number);
    expect(cascade.number).toBeGreaterThan(notion.number);
    expect(cascade.line).toMatch(/when the diff showed changes|first run with no baseline/i);
  });

  // Scenario: Unchanged sprint diff — stop before cascade
  it("stops at diff step 4a without reaching cascade when unchanged", () => {
    const diff = stepByNumber(steps, 4)!;
    const stopBranch = diff.subSteps.find((s) => s.includes("No changes since"));
    expect(stopBranch).toBeDefined();
    expect(stopBranch).toContain("STOP");
    expect(stopBranch).not.toContain("cascade_epic_notion_updates");
    expect(skill.indexOf("cascade_epic_notion_updates")).toBeGreaterThan(skill.indexOf("STOP"));
  });

  // Scenario: Explicit regenerate defers full epic refresh
  it("keeps cascade diff-driven and does not add refresh-all-epic-pages path", () => {
    const regenerateBranch = stepByNumber(steps, 4)!.subSteps.find((s) => s.includes("remove_thread"));
    expect(regenerateBranch).toBeDefined();
    expect(skill).not.toMatch(/refresh.*all.*epic/i);
    expect(stepByNumber(steps, 8)!.line).toMatch(/diff showed changes/i);
  });

  it("registers cascade_epic_notion_updates in the tool catalog", () => {
    expect(cascadeEpicNotionUpdatesTool.name).toBe("cascade_epic_notion_updates");
  });
});

describe("parseSprintNarrativeSteps", () => {
  it("parses numbered steps and lettered sub-steps", () => {
    const sample = `
  1. first step
     a. sub one
     b. sub two
  2. second step
`;
    const steps = parseSprintNarrativeSteps(sample);
    expect(steps).toHaveLength(2);
    expect(steps[0].subSteps).toHaveLength(2);
  });
});
