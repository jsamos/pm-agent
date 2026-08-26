import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("harness entry points", () => {
  it("scripts do not import the OpenAI provider directly", () => {
    const scriptsDir = join(process.cwd(), "src", "scripts");
    const hits: string[] = [];

    for (const entry of readdirSync(scriptsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const path = join(scriptsDir, entry.name);
      const text = readFileSync(path, "utf8");
      if (text.includes("openaiProvider") || text.includes("providers/openai")) {
        hits.push(path);
      }
    }

    expect(hits).toEqual([]);
  });
});
