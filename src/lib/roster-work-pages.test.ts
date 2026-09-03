import { describe, it, expect } from "vitest";
import { findWorkPageEntry, findWorkPageByRef, resolveWorkPageUrl, resolveEpicWorkPage } from "./roster-work-pages.js";
import type { RosterEntry } from "../tools/roster/types.js";

const entry: RosterEntry = {
  name: "Jane",
  shortName: "Jane",
  accountId: "acc-jane",
  displayName: "Jane Smith",
  workPages: [
    { page: "https://notion.so/dso", name: "Platform Epic", epics: ["PROJ-100", "PROJ-200"] },
    { page: "https://notion.so/platform", epics: ["PROJ-300"] },
  ],
};

describe("findWorkPageEntry", () => {
  it("returns matching work page for epic key", () => {
    expect(findWorkPageEntry(entry, "PROJ-100")?.page).toBe("https://notion.so/dso");
    expect(findWorkPageEntry(entry, "PROJ-300")?.page).toBe("https://notion.so/platform");
  });

  it("returns null when epic is unmapped", () => {
    expect(findWorkPageEntry(entry, "PROJ-999")).toBeNull();
  });

  it("returns null when member has no workPages", () => {
    expect(findWorkPageEntry({ ...entry, workPages: undefined }, "PROJ-100")).toBeNull();
  });
});

describe("resolveWorkPageUrl", () => {
  it("returns page URL for mapped epic", () => {
    expect(resolveWorkPageUrl(entry, "PROJ-200")).toBe("https://notion.so/dso");
  });

  it("returns null for unmapped epic", () => {
    expect(resolveWorkPageUrl(entry, "PROJ-999")).toBeNull();
  });
});

describe("findWorkPageByRef", () => {
  // Scenario: Match by URL
  it("matches work page by URL", () => {
    expect(findWorkPageByRef(entry, "https://notion.so/dso")?.page).toBe("https://notion.so/dso");
  });

  // Scenario: Match by name
  it("matches work page by display name case-insensitively", () => {
    expect(findWorkPageByRef(entry, "platform epic")?.page).toBe("https://notion.so/dso");
  });

  // Scenario: URL preferred over name collision
  it("prefers URL match over name match when both could apply", () => {
    const collision: RosterEntry = {
      ...entry,
      workPages: [
        { page: "https://notion.so/shared-label", epics: ["PROJ-1"] },
        { page: "https://notion.so/other", name: "https://notion.so/shared-label", epics: ["PROJ-2"] },
      ],
    };
    const matched = findWorkPageByRef(collision, "https://notion.so/shared-label");
    expect(matched?.epics).toEqual(["PROJ-1"]);
  });

  it("returns undefined when no work page matches ref", () => {
    expect(findWorkPageByRef(entry, "missing")).toBeUndefined();
  });
});

describe("resolveEpicWorkPage", () => {
  const roster = [entry];

  // Scenario: Mapped work page found
  it("returns work page URL for mapped epic on roster member", () => {
    const result = resolveEpicWorkPage(roster, "acc-jane", "PROJ-100");
    expect(result).toEqual({
      found: true,
      pageUrl: "https://notion.so/dso",
      name: "Platform Epic",
      epics: ["PROJ-100", "PROJ-200"],
      displayName: "Jane Smith",
    });
  });

  // Scenario: Epic not mapped on member
  it("returns not created when epic is not on member work pages", () => {
    expect(resolveEpicWorkPage(roster, "acc-jane", "PROJ-999")).toEqual({
      found: false,
      reason: "not created",
    });
  });

  // Scenario: Assignee not on roster
  it("returns assignee not on roster when account ID is unknown", () => {
    expect(resolveEpicWorkPage(roster, "acc-unknown", "PROJ-100")).toEqual({
      found: false,
      reason: "assignee not on roster",
    });
  });
});
