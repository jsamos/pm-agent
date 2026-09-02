/**
 * Parse numbered steps from sprint-narrative skill text for workflow tests.
 */

export interface SkillStep {
  number: number;
  line: string;
  subSteps: string[];
}

export function parseSprintNarrativeSteps(skillText: string): SkillStep[] {
  const lines = skillText.split("\n");
  const steps: SkillStep[] = [];
  let current: SkillStep | null = null;

  for (const line of lines) {
    const main = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (main) {
      if (current) steps.push(current);
      current = { number: Number(main[1]), line: main[2], subSteps: [] };
      continue;
    }
    if (current && /^\s+[a-z]\.\s+/i.test(line)) {
      current.subSteps.push(line.trim());
    }
  }
  if (current) steps.push(current);
  return steps;
}

export function stepByNumber(steps: SkillStep[], n: number): SkillStep | undefined {
  return steps.find((s) => s.number === n);
}
