import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSprintNarrativeSteps, stepByNumber } from "./sprint-narrative-steps.js";
import { resolveEpicWorkPageTool } from "../tools/roster/resolve-epic-work-page.js";

const SKILL_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "epic-narrative.md");

describe("epic-narrative skill workflow", () => {
  const skill = readFileSync(SKILL_PATH, "utf-8");
  const steps = parseSprintNarrativeSteps(skill);

  // Scenario: Assignee with mapped work page
  it("resolves roster work page after assignee resolution and publishes after narrative", () => {
    const assigneeStep = stepByNumber(steps, 1)!;
    expect(assigneeStep.line).toContain("resolve_assignees");
    expect(assigneeStep.subSteps.some((s) => s.includes("resolve_epic_work_page"))).toBe(true);

    const publish = stepByNumber(steps, 7)!;
    expect(publish.line).toMatch(/Publish to Notion/i);
    expect(publish.subSteps.some((s) => s.includes("update_notion_page"))).toBe(true);
    expect(publish.subSteps.some((s) => s.includes('contentFrom: "generate_epic_narrative"'))).toBe(
      true,
    );
    expect(publish.number).toBeGreaterThan(stepByNumber(steps, 6)!.number);
  });

  // Scenario: Explicit Notion URL overrides roster
  it("skips roster lookup when user provides explicit Notion URL", () => {
    const assigneeStep = stepByNumber(steps, 1)!;
    const explicitBranch = assigneeStep.subSteps.find((s) => s.includes("Notion page URL"));
    expect(explicitBranch).toBeDefined();
    expect(explicitBranch).toMatch(/skip roster lookup/i);
  });

  // Scenario: Assignee without work page mapping
  it("notes not created when assignee work page is unmapped", () => {
    const publish = stepByNumber(steps, 7)!;
    const unmappedBranch = publish.subSteps.find((s) => s.includes("not created"));
    expect(unmappedBranch).toBeDefined();
    expect(unmappedBranch).not.toMatch(/update_notion_page is called/i);
    expect(unmappedBranch).toMatch(/not mapped/i);
  });

  // Scenario: Unchanged diff stops before publish
  it("stops before narrative and Notion when diff is unchanged", () => {
    const diff = stepByNumber(steps, 4)!;
    const stopBranch = diff.subSteps.find((s) => s.includes("No changes since"));
    expect(stopBranch).toBeDefined();
    expect(stopBranch).toContain("STOP");
    expect(stopBranch).toContain("update_notion_page");
    expect(stopBranch).toContain("generate_epic_narrative");
  });

  // Scenario: No assignee — no roster publish
  it("skips Notion publish when no assignee and no explicit URL", () => {
    const publish = stepByNumber(steps, 7)!;
    const noAssigneeBranch = publish.subSteps.find((s) => s.includes("no assignee"));
    expect(noAssigneeBranch).toBeDefined();
    expect(noAssigneeBranch).toMatch(/no Notion step/i);
  });

  it("registers resolve_epic_work_page in the tool catalog", () => {
    expect(resolveEpicWorkPageTool.name).toBe("resolve_epic_work_page");
  });

  // Scenario: Sprint cascade independent
  it("does not alter sprint cascade workflow", () => {
    expect(skill).not.toContain("cascade_epic_notion_updates");
  });
});
