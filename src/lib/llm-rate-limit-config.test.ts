import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("NARRATIVE_LLM_CONCURRENCY removal", () => {
  it("is not referenced in src/", () => {
    const hits: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(path);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          const text = readFileSync(path, "utf8");
          if (text.includes("NARRATIVE_LLM_CONCURRENCY")) {
            hits.push(path);
          }
        }
      }
    }

    walk(join(process.cwd(), "src"));
    expect(hits).toEqual([]);
  });
});
