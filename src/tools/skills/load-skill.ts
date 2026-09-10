import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "../registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = resolve(__dirname, "../../skills");

interface SkillEntry {
  name: string;
  description: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const DESCRIPTION_RE = /^description:\s*(.+)$/m;

function parseFrontmatter(text: string): { name?: string; description?: string } {
  const fm = text.match(FRONTMATTER_RE);
  if (!fm) return {};
  const block = fm[1];
  const nameMatch = block.match(/^name:\s*(.+)$/m);
  const descMatch = block.match(DESCRIPTION_RE);
  return {
    name: nameMatch?.[1].trim(),
    description: descMatch?.[1].trim(),
  };
}

export function listSkills(): SkillEntry[] {
  return readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith(".md"))
    .flatMap((f) => {
      const text = readFileSync(resolve(SKILLS_DIR, f), "utf-8");
      const fm = parseFrontmatter(text);
      if (!fm.name || !fm.description) return [];
      return [{ name: fm.name, description: fm.description }];
    });
}

function formatSkillList(skills: SkillEntry[]): string {
  return skills.map((s) => `${s.name} (${s.description})`).join(", ");
}

const skills = listSkills();

export const loadSkillTool: Tool = {
  name: "load_skill",
  description:
    "Load step-by-step workflow instructions for a named skill. " +
    "Returns the full skill text so you can follow it. " +
    `Available skills: ${formatSkillList(skills)}`,
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: `Skill name (one of: ${skills.map((s) => s.name).join(", ")})`,
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
      const available = skills.map((s) => s.name);
      throw new Error(`Unknown skill "${name}". Available: ${available.join(", ")}`);
    }
  },
};
