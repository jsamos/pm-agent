import { describe, it, expect, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() =>
    JSON.stringify({
      resolved: [
        {
          name: "Jane Smith",
          shortName: "Jane",
          accountId: "acc-jane",
          displayName: "Jane Smith",
          notion: { homepageUrl: "https://notion.so/jane-hub" },
          slack: { channelId: "C01234567" },
          workPages: [{ page: "https://notion.so/page", epics: ["PROJ-100", "PROJ-200"] }],
        },
      ],
      unresolved: [],
      generatedAt: "",
    }),
  ),
}));

import { readRosterTool } from "./read.js";

describe("readRosterTool", () => {
  it("returns notion, slack, and workPages for each resolved entry", async () => {
    const result = await readRosterTool.execute({});

    expect(result.resolved[0].notion?.homepageUrl).toBe("https://notion.so/jane-hub");
    expect(result.resolved[0].slack?.channelId).toBe("C01234567");
    expect(result.resolved[0].workPages).toEqual([
      { page: "https://notion.so/page", epics: ["PROJ-100", "PROJ-200"] },
    ]);
  });
});
