import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "../registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = resolve(__dirname, "../../skills");

function listSkillNames(): string[] {
  return readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => basename(f, ".md"));
}

export const loadSkillTool: Tool = {
  name: "load_skill",
  description:
    "Load step-by-step workflow instructions for a named skill. " +
    "Returns the full skill text so you can follow it. " +
    `Available skills: ${listSkillNames().join(", ")}`,
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: `Skill name (one of: ${listSkillNames().join(", ")})`,
      },
    },
    required: ["name"],
  },
  async execute(args) {
    const name = String(args.name);
    const file = resolve(SKILLS_DIR, `${name}.md`);
    try {
      const content = readFileSync(file, "utf-8").trim();
      return { skill: name, instructions: content };
    } catch {
      const available = listSkillNames();
      throw new Error(`Unknown skill "${name}". Available: ${available.join(", ")}`);
    }
  },
};
