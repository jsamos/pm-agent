import { describe, it, expect } from "vitest";
import { findWorkPageEntry, resolveWorkPageUrl } from "./roster-work-pages.js";
import type { RosterEntry } from "../tools/roster/types.js";

const entry: RosterEntry = {
  name: "Jane",
  shortName: "Jane",
  accountId: "acc-jane",
  displayName: "Jane Smith",
  workPages: [
    { page: "https://notion.so/dso", epics: ["PROJ-100", "PROJ-200"] },
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
