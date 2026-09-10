import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSprintNarrativeSteps, stepByNumber } from "./sprint-narrative-steps.js";
import { listSkills } from "../tools/skills/load-skill.js";

const SKILL_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "meeting-ppoa.md");

describe("meeting-ppoa skill workflow", () => {
  const skill = readFileSync(SKILL_PATH, "utf-8");
  const steps = parseSprintNarrativeSteps(skill);

  // Scenario: Notion URL triggers fetch
  it("first step instructs calling fetch_notion_transcript for a Notion URL", () => {
    const step1 = stepByNumber(steps, 1)!;
    expect(step1).toBeDefined();
    expect(step1.line).toContain("fetch_notion_transcript");
    expect(step1.line).toMatch(/notion.*url/i);
  });

  // Scenario: Inline or uploaded transcript skips fetch
  it("second step uses pasted or uploaded transcript directly without fetch", () => {
    const step2 = stepByNumber(steps, 2)!;
    expect(step2).toBeDefined();
    expect(step2.line).toMatch(/pasted|uploaded/i);
    expect(step2.line).toMatch(/no fetch/i);
  });

  it("third step calls generate_meeting_ppoa for the PPOA breakdown", () => {
    const step3 = stepByNumber(steps, 3)!;
    expect(step3).toBeDefined();
    expect(step3.line).toContain("generate_meeting_ppoa");
  });

  // Scenario: Orchestrator skill index
  it("appears in load_skill available skills with a description", () => {
    const skills = listSkills();
    const ppoa = skills.find((s) => s.name === "meeting-ppoa");
    expect(ppoa).toBeDefined();
    expect(ppoa!.description).toBeTruthy();
  });
});
