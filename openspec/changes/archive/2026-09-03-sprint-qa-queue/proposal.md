# Sprint QA Queue in Assignee Narrative

## Intent

In **assignee-grouped sprint narratives**, tickets in QA status assigned to non-QA engineers are work waiting for the QA team — not active development for the original assignee. Today they appear under the developer's **In Motion** section (via Jira `statusCategory`).

For roster members with the **`qa` role**, those tickets SHOULD appear in **Not Started** — the QA engineer's queue — while QA-status tickets assigned to the QA engineer themselves remain **In Motion** (active validation).

This is a **narrative grouping** change only. Jira assignees are unchanged. Existing **assignee-based QA language hints** (`buildQaLanguageHints`) remain as-is — no viewer-aware hint variant.

## Scope

- **Post-process** `group_issues` output inside `generate_sprint_narrative` when `groupBy` starts with `assignee` (including after automatic upgrade to `assignee → status → epic`)
- **Move** dev-assigned QA-status issues from the original assignee's `in_progress` into each QA-role assignee's `not_started` (by epic sub-group)
- **Deduplicate**: removed from the original assignee's section — each waiting ticket appears only under QA queue section(s), not both
- **Ensure QA assignee groups exist** when a member has queue items but no directly assigned sprint tickets
- Pure helper in `src/lib/roster-roles.ts` (or adjacent lib) + tests
- Epic narrative (`generate_epic_narrative`), epic cascade, and `group_issues` tool behavior unchanged

## Out of scope

- Epic narrative or epic Notion work pages
- Changes to `buildQaLanguageHints` or sprint/epic system prompts (assignee-based hints are sufficient)
- Sprint narratives grouped by **epic** first (`groupBy: ["epic", "status"]`)
- Reassigning Jira tickets or changing who owns QA work
- Splitting the QA queue among multiple QA engineers (each QA-role section receives the full dev-assigned QA queue when multiple QA engineers appear in the report; noted as acceptable MVP duplication)
- Status names other than `"QA"` (existing `isQaStatus()` exact match)
