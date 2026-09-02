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

  it("set_roles preserves notion and workPages", () => {
    const roster = sampleRoster();
    roster.resolved[0].notion = { homepageUrl: "https://notion.so/jane" };
    roster.resolved[0].workPages = [{ page: "https://notion.so/epic", epics: ["PROJ-1"] }];
    applyRosterWrite(roster, { action: "set_roles", accountId: "acc-jane", roles: ["qa"] });
    expect(roster.resolved[0].roles).toEqual(["qa"]);
    expect(roster.resolved[0].notion?.homepageUrl).toBe("https://notion.so/jane");
    expect(roster.resolved[0].workPages?.[0].epics).toEqual(["PROJ-1"]);
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
    expect(jane.workPages?.[0]?.epics?.length).toBeGreaterThan(0);
    const alex = example.resolved.find((r: { accountId: string }) => r.accountId.includes("0002"));
    expect(alex.slack?.channelId).toBeTruthy();
  });
});
