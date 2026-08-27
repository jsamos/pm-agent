import jiraExample from "../config/jira.example.json" with { type: "json" };

const descriptionLimitDefault =
  (jiraExample as { narrative?: { descriptionLimit?: number } }).narrative?.descriptionLimit ?? 1000;

/** Jira issue description truncation — override via jira.json narrative.descriptionLimit. */
export function resolveDescriptionLimit(jiraNarrative?: Record<string, unknown>): number {
  const limit = jiraNarrative?.descriptionLimit;
  return typeof limit === "number" ? limit : descriptionLimitDefault;
}
