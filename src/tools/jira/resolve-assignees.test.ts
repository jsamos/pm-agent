import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the fs module before importing the tool
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => JSON.stringify({
    resolved: [
      { name: "Alice", shortName: "Alice", accountId: "acc-alice", displayName: "Alice Martin" },
      { name: "Bob", shortName: "Bob", accountId: "acc-bob", displayName: "Bob Chen" },
      { name: "Carol", shortName: "Carol", accountId: "acc-carol", displayName: "Carol Davis" },
      { name: "Dan", shortName: "Dan", accountId: "acc-dan", displayName: "Dan Torres" },
    ],
  })),
}));

import { resolveAssigneesTool } from "./resolve-assignees.js";

const execute = (args: Record<string, unknown>) =>
  resolveAssigneesTool.execute(args, {} as never);

describe("resolve_assignees", () => {
  describe("filter: roster", () => {
    it("returns all account IDs", async () => {
      const result = await execute({ filter: "roster" }) as { accountIds: string[] };
      expect(result.accountIds).toEqual(["acc-alice", "acc-bob", "acc-carol", "acc-dan"]);
    });
  });

  describe("filter: specific names", () => {
    it("resolves exact match (case-insensitive)", async () => {
      const result = await execute({ filter: ["alice"] }) as { resolved: Array<{ name: string; accountId: string }> };
      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0]).toMatchObject({ name: "Alice Martin", accountId: "acc-alice" });
    });

    it("resolves prefix match (3+ chars)", async () => {
      const result = await execute({ filter: ["Dan"] }) as { resolved: Array<{ name: string; accountId: string }> };
      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0]).toMatchObject({ name: "Dan Torres", accountId: "acc-dan" });
    });

    it("resolves fuzzy match (Levenshtein ≤ 2)", async () => {
      const result = await execute({ filter: ["Alce"] }) as { resolved: Array<{ name: string; accountId: string }> };
      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0]).toMatchObject({ name: "Alice Martin", accountId: "acc-alice" });
    });

    it("reports unresolved names", async () => {
      const result = await execute({ filter: ["zzzzz"] }) as { unresolved: string[]; warning: string };
      expect(result.unresolved).toEqual(["zzzzz"]);
      expect(result.warning).toContain("zzzzz");
    });

    it("resolves multiple names in one call", async () => {
      const result = await execute({ filter: ["Alice", "Bob"] }) as { accountIds: string[] };
      expect(result.accountIds).toEqual(["acc-alice", "acc-bob"]);
    });

    it("exact match beats prefix match", async () => {
      const result = await execute({ filter: ["Bob"] }) as { resolved: Array<{ name: string }> };
      expect(result.resolved[0].name).toBe("Bob Chen");
    });
  });
});
