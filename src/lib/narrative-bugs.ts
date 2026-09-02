/**
 * Dynamic user-message hints for Bug stabilization paragraphs in sprint narratives.
 */

import type { JiraIssue } from "../tools/jira/search-issues.js";

export function hasBugIssues(issues: JiraIssue[]): boolean {
  return issues.some((i) => i.issueType === "Bug");
}

/**
 * Sprint-only: delivery vs. stabilization paragraph rules when Bugs are in the batch.
 * Returns null when no Bug issues are present.
 */
export function buildBugStabilizationHints(issues: JiraIssue[]): string | null {
  const bugs = issues.filter((i) => i.issueType === "Bug");
  if (bugs.length === 0) return null;

  const bugKeys = bugs.map((i) => i.key).join(", ");

  return [
    "--- BUG STABILIZATION (issues with type Bug in this batch) ---",
    "",
    `Bug tickets in this batch: ${bugKeys}`,
    "",
    "Within each status section (### What's Been Done / In Motion / Not Started), group by epic using [Epic: ...] tags. For each epic in that section:",
    "",
    "**Delivery paragraph(s)** — all non-Bug issues for that epic. Describe the capability being built or shipped. Do not cite or mention Bug tickets here.",
    "",
    "**Stabilization paragraph** — all Bug issues for that epic in this section, in one paragraph immediately after the delivery paragraph(s). Describe corrective work along the way: edge cases, regressions, integration surprises, QA findings.",
    "",
    "Rules for Bug issues:",
    '- A Bug\'s description reports the *defect*, not the intended behavior. Look for an "Acceptance Criteria" or "A/C" section for the correct behavior, or infer it from the summary. Do not narrate the bug report.',
    "- Describe the intended behavior that was restored or secured, not the failure mode.",
    '- Words like "corrected", "addressed", "stabilized", and "resolved" are appropriate in the stabilization paragraph only.',
    '- Do not use "bug", "defect", or "issue" as nouns. Do not lead with "Fixed …" or "Resolved bug …".',
    "- Every Bug MUST appear as an inline citation in the stabilization paragraph.",
    "- Do not mix Bug citations into delivery paragraphs.",
    "",
    "When to write which paragraphs:",
    "- Epic has both delivery and Bug work → delivery paragraph(s), then stabilization paragraph.",
    "- Epic has only non-Bug work → delivery paragraph(s) only.",
    "- Epic has only Bug work in a section → stabilization paragraph only.",
  ].join("\n");
}
