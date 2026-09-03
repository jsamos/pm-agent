import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyRosterWrite } from "./mutations.js";
import type { RosterFile } from "./types.js";

function emptyRoster(): RosterFile {
  return { resolved: [], unresolved: [], generatedAt: "" };
}

function sampleRoster(): RosterFile {
  return {
    resolved: [
      {
        name: "Jane Smith",
        shortName: "Jane",
        accountId: "acc-jane",
        displayName: "Jane Smith",
      },
    ],
    unresolved: [],
    generatedAt: "",
  };
}

describe("applyRosterWrite", () => {
  it("add preserves optional publishing fields", () => {
    const roster = emptyRoster();
    const result = applyRosterWrite(roster, {
      action: "add",
      accountId: "acc-jane",
      name: "Jane Smith",
      displayName: "Jane Smith",
      notion: { homepageUrl: "https://notion.so/jane-hub" },
      workPages: [{ page: "https://notion.so/jane-proj", epics: ["PROJ-100"] }],
    });
    expect(result.success).toBe(true);
    expect(roster.resolved[0].notion?.homepageUrl).toBe("https://notion.so/jane-hub");
    expect(roster.resolved[0].workPages?.[0].epics).toEqual(["PROJ-100"]);
  });

  it("set_notion updates homepageUrl", () => {
    const roster = sampleRoster();
    const result = applyRosterWrite(roster, {
      action: "set_notion",
      accountId: "acc-jane",
      homepageUrl: "https://notion.so/jane-hub",
    });
    expect(result.success).toBe(true);
    expect(roster.resolved[0].notion?.homepageUrl).toBe("https://notion.so/jane-hub");
  });

  it("set_slack updates channelId", () => {
    const roster = sampleRoster();
    applyRosterWrite(roster, {
      action: "set_slack",
      accountId: "acc-jane",
      channelId: "C01234567",
    });
    expect(roster.resolved[0].slack?.channelId).toBe("C01234567");
  });

  it("add_work_page appends a new page entry", () => {
    const roster = sampleRoster();
    applyRosterWrite(roster, {
      action: "add_work_page",
      accountId: "acc-jane",
      page: "https://notion.so/dso",
      epics: ["PROJ-100", "PROJ-200"],
    });
    expect(roster.resolved[0].workPages).toEqual([
      { page: "https://notion.so/dso", epics: ["PROJ-100", "PROJ-200"] },
    ]);
  });

  // Scenario: New work page
  it("add_work_page appends a new page entry with name", () => {
    const roster = sampleRoster();
    applyRosterWrite(roster, {
      action: "add_work_page",
      accountId: "acc-jane",
      page: "https://notion.so/platform",
      name: "Platform Epic",
      epics: ["PROJ-100"],
    });
    expect(roster.resolved[0].workPages).toEqual([
      { page: "https://notion.so/platform", name: "Platform Epic", epics: ["PROJ-100"] },
    ]);
  });

  it("add_work_page merges epics when page URL already exists", () => {
    const roster = sampleRoster();
    roster.resolved[0].workPages = [{ page: "https://notion.so/dso", epics: ["PROJ-100"] }];
    applyRosterWrite(roster, {
      action: "add_work_page",
      accountId: "acc-jane",
      page: "https://notion.so/dso",
      epics: ["PROJ-200"],
    });
    expect(roster.resolved[0].workPages?.[0].epics).toEqual(["PROJ-100", "PROJ-200"]);
  });

  // Scenario: Merge epics on existing URL
  it("add_work_page merges epics and updates name when page URL already exists", () => {
    const roster = sampleRoster();
    roster.resolved[0].workPages = [{ page: "https://notion.so/dso", epics: ["PROJ-100"] }];
    applyRosterWrite(roster, {
      action: "add_work_page",
      accountId: "acc-jane",
      page: "https://notion.so/dso",
      name: "Platform Epic",
      epics: ["PROJ-200"],
    });
    expect(roster.resolved[0].workPages?.[0]).toEqual({
      page: "https://notion.so/dso",
      name: "Platform Epic",
      epics: ["PROJ-100", "PROJ-200"],
    });
  });

  // Scenario: Page URL is identity key
  it("add_work_page keeps a single entry when called twice for the same URL", () => {
    const roster = sampleRoster();
    applyRosterWrite(roster, {
      action: "add_work_page",
      accountId: "acc-jane",
      page: "https://notion.so/dso",
      epics: ["PROJ-100"],
    });
    applyRosterWrite(roster, {
      action: "add_work_page",
      accountId: "acc-jane",
      page: "https://notion.so/dso",
      epics: ["PROJ-200"],
    });
    expect(roster.resolved[0].workPages).toHaveLength(1);
    expect(roster.resolved[0].workPages?.[0].epics).toEqual(["PROJ-100", "PROJ-200"]);
  });

  it("remove_work_page removes by page URL", () => {
    const roster = sampleRoster();
    roster.resolved[0].workPages = [{ page: "https://notion.so/dso", epics: ["PROJ-100"] }];
    applyRosterWrite(roster, {
      action: "remove_work_page",
      accountId: "acc-jane",
      page: "https://notion.so/dso",
    });
    expect(roster.resolved[0].workPages).toBeUndefined();
  });

  // Scenario: Remove by display name
  it("remove_work_page removes by display name", () => {
    const roster = sampleRoster();
    roster.resolved[0].workPages = [
      { page: "https://notion.so/dso", name: "Platform Epic", epics: ["PROJ-100"] },
    ];
    applyRosterWrite(roster, {
      action: "remove_work_page",
      accountId: "acc-jane",
      page: "platform epic",
    });
    expect(roster.resolved[0].workPages).toBeUndefined();
  });

  // Scenario: Partial epic removal
  it("remove_epics_from_work_page removes listed epics and keeps the entry", () => {
    const roster = sampleRoster();
    roster.resolved[0].workPages = [
      { page: "https://notion.so/dso", epics: ["PROJ-100", "PROJ-200"] },
    ];
    applyRosterWrite(roster, {
      action: "remove_epics_from_work_page",
      accountId: "acc-jane",
      page: "https://notion.so/dso",
      epics: ["PROJ-100"],
    });
    expect(roster.resolved[0].workPages).toEqual([
      { page: "https://notion.so/dso", epics: ["PROJ-200"] },
    ]);
  });

  // Scenario: Remove last epic
  it("remove_epics_from_work_page removes entry when last epic is removed", () => {
    const roster = sampleRoster();
    roster.resolved[0].workPages = [{ page: "https://notion.so/dso", epics: ["PROJ-100"] }];
    applyRosterWrite(roster, {
      action: "remove_epics_from_work_page",
      accountId: "acc-jane",
      page: "https://notion.so/dso",
      epics: ["PROJ-100"],
    });
    expect(roster.resolved[0].workPages).toBeUndefined();
  });

  // Scenario: Epic not on page
  it("remove_epics_from_work_page succeeds when epic is not on the page", () => {
    const roster = sampleRoster();
    roster.resolved[0].workPages = [{ page: "https://notion.so/dso", epics: ["PROJ-100"] }];
    const result = applyRosterWrite(roster, {
      action: "remove_epics_from_work_page",
      accountId: "acc-jane",
      page: "https://notion.so/dso",
      epics: ["PROJ-999"],
    });
    expect(result.success).toBe(true);
    expect(roster.resolved[0].workPages?.[0].epics).toEqual(["PROJ-100"]);
  });

  // Scenario: Work page not found
  it("remove_epics_from_work_page fails when work page ref is not found", () => {
    const roster = sampleRoster();
    roster.resolved[0].workPages = [{ page: "https://notion.so/dso", epics: ["PROJ-100"] }];
    const result = applyRosterWrite(roster, {
      action: "remove_epics_from_work_page",
      accountId: "acc-jane",
      page: "missing page",
      epics: ["PROJ-100"],
    });
    expect(result.success).toBe(false);
    expect(roster.resolved[0].workPages).toHaveLength(1);
  });

  // Scenario: Set name on existing page
  it("set_work_page_name sets display name on matched page", () => {
    const roster = sampleRoster();
    roster.resolved[0].workPages = [{ page: "https://notion.so/dso", epics: ["PROJ-100"] }];
    applyRosterWrite(roster, {
      action: "set_work_page_name",
      accountId: "acc-jane",
      page: "https://notion.so/dso",
      name: "Platform Epic",
    });
    expect(roster.resolved[0].workPages?.[0].name).toBe("Platform Epic");
  });

  // Scenario: Missing name
  it("set_work_page_name fails when name is empty", () => {
    const roster = sampleRoster();
    roster.resolved[0].workPages = [{ page: "https://notion.so/dso", epics: ["PROJ-100"] }];
    const result = applyRosterWrite(roster, {
      action: "set_work_page_name",
      accountId: "acc-jane",
      page: "https://notion.so/dso",
      name: "   ",
    });
    expect(result.success).toBe(false);
  });

  // Scenario: Missing page or epics / Member not on roster
  it("add_work_page fails when page or epics are missing", () => {
    const roster = sampleRoster();
    expect(
      applyRosterWrite(roster, {
        action: "add_work_page",
        accountId: "acc-jane",
        page: "",
        epics: ["PROJ-100"],
      }).success,
    ).toBe(false);
    expect(
      applyRosterWrite(roster, {
        action: "add_work_page",
        accountId: "acc-jane",
        page: "https://notion.so/dso",
        epics: [],
      }).success,
    ).toBe(false);
    expect(
      applyRosterWrite(roster, {
        action: "add_work_page",
        accountId: "missing",
        page: "https://notion.so/dso",
        epics: ["PROJ-100"],
      }).success,
    ).toBe(false);
  });

  // Scenario: Epic already on another page
  it("add_work_page warns when epic is already mapped on another page", () => {
    const roster = sampleRoster();
    roster.resolved[0].workPages = [
      { page: "https://notion.so/page-a", name: "Page A", epics: ["PROJ-100"] },
    ];
    const result = applyRosterWrite(roster, {
      action: "add_work_page",
      accountId: "acc-jane",
      page: "https://notion.so/page-b",
      epics: ["PROJ-100"],
    });
    expect(result.success).toBe(true);
    expect(result.warning).toContain("PROJ-100");
    expect(result.warning).toContain("Page A");
  });

  it("set_roles preserves notion and workPages", () => {
    const roster = sampleRoster();
    roster.resolved[0].notion = { homepageUrl: "https://notion.so/jane" };
    roster.resolved[0].workPages = [
      { page: "https://notion.so/epic", name: "Platform Epic", epics: ["PROJ-1"] },
    ];
    applyRosterWrite(roster, { action: "set_roles", accountId: "acc-jane", roles: ["qa"] });
    expect(roster.resolved[0].roles).toEqual(["qa"]);
    expect(roster.resolved[0].notion?.homepageUrl).toBe("https://notion.so/jane");
    expect(roster.resolved[0].workPages?.[0].epics).toEqual(["PROJ-1"]);
    expect(roster.resolved[0].workPages?.[0].name).toBe("Platform Epic");
  });

  // Scenario: Other publishing config preserved
  it("work page mutations preserve notion and slack on the member", () => {
    const roster = sampleRoster();
    roster.resolved[0].notion = { homepageUrl: "https://notion.so/jane-hub" };
    roster.resolved[0].slack = { channelId: "C01234567" };
    applyRosterWrite(roster, {
      action: "add_work_page",
      accountId: "acc-jane",
      page: "https://notion.so/dso",
      name: "Platform Epic",
      epics: ["PROJ-100"],
    });
    expect(roster.resolved[0].notion?.homepageUrl).toBe("https://notion.so/jane-hub");
    expect(roster.resolved[0].slack?.channelId).toBe("C01234567");
  });

  it("fails set_notion when account not on roster", () => {
    const roster = emptyRoster();
    const result = applyRosterWrite(roster, {
      action: "set_notion",
      accountId: "missing",
      homepageUrl: "https://notion.so/x",
    });
    expect(result.success).toBe(false);
  });
});

describe("roster.example.json", () => {
  it("includes optional publishing fields", () => {
    const example = JSON.parse(
      readFileSync(resolve("src/config/roster.example.json"), "utf-8"),
    );
    const jane = example.resolved.find((r: { accountId: string }) => r.accountId.includes("0001"));
    expect(jane.notion?.homepageUrl).toBeTruthy();
    expect(jane.workPages?.[0]?.page).toBeTruthy();
    expect(jane.workPages?.[0]?.name).toBeTruthy();
    expect(jane.workPages?.[0]?.epics?.length).toBeGreaterThan(0);
    const alex = example.resolved.find((r: { accountId: string }) => r.accountId.includes("0002"));
    expect(alex.slack?.channelId).toBeTruthy();
  });
});
