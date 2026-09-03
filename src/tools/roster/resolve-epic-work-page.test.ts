import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveEpicWorkPageTool } from "./resolve-epic-work-page.js";
import type { RosterFile } from "./types.js";

const mockRoster: RosterFile = {
  generatedAt: "2026-01-01T00:00:00Z",
  unresolved: [],
  resolved: [
    {
      name: "Alice",
      shortName: "Alice",
      accountId: "acc-alice",
      displayName: "Alice Martin",
      workPages: [{ page: "https://notion.so/epic-work", epics: ["PROJ-100"] }],
    },
  ],
};

vi.mock("./read.js", () => ({
  loadRosterFile: vi.fn(() => mockRoster),
}));

describe("resolve_epic_work_page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns mapped work page for roster member and epic", async () => {
    const result = await resolveEpicWorkPageTool.execute({
      accountId: "acc-alice",
      epicKey: "PROJ-100",
    });
    expect(result).toEqual({
      found: true,
      pageUrl: "https://notion.so/epic-work",
      epics: ["PROJ-100"],
      displayName: "Alice Martin",
    });
  });

  it("returns not created when epic is unmapped", async () => {
    const result = await resolveEpicWorkPageTool.execute({
      accountId: "acc-alice",
      epicKey: "PROJ-999",
    });
    expect(result).toEqual({ found: false, reason: "not created" });
  });

  it("throws when accountId or epicKey is missing", async () => {
    await expect(resolveEpicWorkPageTool.execute({ epicKey: "PROJ-100" })).rejects.toThrow(
      "accountId is required",
    );
    await expect(resolveEpicWorkPageTool.execute({ accountId: "acc-alice" })).rejects.toThrow(
      "epicKey is required",
    );
  });
});
