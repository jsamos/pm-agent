/** Rendered markdown headings for narrative status sections. */
export const NARRATIVE_HEADINGS = {
  done: "### What's Been Done",
  inProgress: "### What's In Motion",
  notStarted: "### Not Started",
} as const;

/** Labels in LLM user messages — match output field names exactly. */
export const NARRATIVE_MESSAGE_LABELS = {
  done: "done",
  inProgress: "inProgress",
  notStarted: "notStarted",
} as const;
