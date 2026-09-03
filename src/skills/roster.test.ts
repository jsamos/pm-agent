import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "roster.md");

describe("roster skill workflow", () => {
  const skill = readFileSync(SKILL_PATH, "utf-8");

  // Scenario: Named member in user request
  it("instructs resolve_assignees before write_roster for work page updates", () => {
    const workPages = skill.slice(skill.indexOf("Work page management"));
    expect(workPages).toContain("resolve_assignees");
    expect(workPages.indexOf("resolve_assignees")).toBeLessThan(workPages.indexOf("add_work_page"));
    expect(workPages).toContain("remove_epics_from_work_page");
    expect(workPages).toContain("set_work_page_name");
  });

  // Scenario: Inspect before edit
  it("allows read_roster before write_roster when confirming mappings", () => {
    expect(skill).toContain("read_roster");
    expect(skill).toMatch(/read_roster first when confirming/i);
  });
});
