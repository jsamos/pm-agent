# Epic Narrative Work Page Publish

## Purpose

When generating an assignee-filtered epic narrative, resolve the roster member's Notion work page for the epic and publish the narrative after generation. Complements sprint cascade for on-demand epic updates.

## Requirements

### Requirement: Work Page Resolution Tool

The system SHALL provide a tool that resolves a roster work page URL from assignee account ID and epic key.

#### Scenario: Mapped work page found [tested]

- GIVEN roster member Alice Martin has `workPages` containing `{ page: "<url>", epics: ["PROJ-100"] }`
- WHEN `resolve_epic_work_page` is called with Alice's accountId and epic key `PROJ-100`
- THEN the result includes `found: true` and the Notion page URL
- **Test:** `returns work page URL for mapped epic on roster member` — [`src/lib/roster-work-pages.test.ts`](../../../src/lib/roster-work-pages.test.ts)

#### Scenario: Epic not mapped on member [tested]

- GIVEN roster member Alice Martin has no work page listing `PROJ-100`
- WHEN `resolve_epic_work_page` is called with Alice's accountId and `PROJ-100`
- THEN the result includes `found: false` and reason `"not created"`
- **Test:** `returns not created when epic is not on member work pages` — [`src/lib/roster-work-pages.test.ts`](../../../src/lib/roster-work-pages.test.ts)

#### Scenario: Assignee not on roster [tested]

- GIVEN no roster entry matches the accountId
- WHEN `resolve_epic_work_page` is called
- THEN the result includes `found: false` and reason `"assignee not on roster"`
- **Test:** `returns assignee not on roster when account ID is unknown` — [`src/lib/roster-work-pages.test.ts`](../../../src/lib/roster-work-pages.test.ts)

### Requirement: Epic Narrative Skill Orchestration

The epic narrative skill SHALL resolve and publish to a work page when an assignee is specified.

#### Scenario: Assignee with mapped work page [tested]

- GIVEN the user requests an epic narrative for `PROJ-100` for a roster assignee
- AND that assignee has a work page mapping for `PROJ-100`
- WHEN the skill completes narrative generation
- THEN `update_notion_page` is called with `contentFrom: "generate_epic_narrative"` and the resolved page URL
- **Test:** `resolves roster work page after assignee resolution and publishes after narrative` — [`src/skills/epic-narrative.test.ts`](../../../src/skills/epic-narrative.test.ts)

#### Scenario: Explicit Notion URL overrides roster [tested]

- GIVEN the user provides a Notion page URL in the request
- WHEN the skill publishes after narrative generation
- THEN `update_notion_page` uses the user-provided URL
- AND roster lookup is skipped
- **Test:** `skips roster lookup when user provides explicit Notion URL` — [`src/skills/epic-narrative.test.ts`](../../../src/skills/epic-narrative.test.ts)

#### Scenario: Assignee without work page mapping [tested]

- GIVEN the user requests an epic narrative for an assignee with no work page for that epic
- WHEN narrative generation completes
- THEN the narrative is returned to the user
- AND the response notes the work page was not mapped (`"not created"`)
- AND `update_notion_page` is NOT called
- **Test:** `notes not created when assignee work page is unmapped` — [`src/skills/epic-narrative.test.ts`](../../../src/skills/epic-narrative.test.ts)

#### Scenario: Unchanged diff stops before publish [tested]

- GIVEN the snapshot diff reports no changes
- WHEN the skill takes the STOP branch at step 4a
- THEN neither `generate_epic_narrative` nor `update_notion_page` is called
- **Test:** `stops before narrative and Notion when diff is unchanged` — [`src/skills/epic-narrative.test.ts`](../../../src/skills/epic-narrative.test.ts)

#### Scenario: No assignee — no roster publish [tested]

- GIVEN the user requests an epic narrative without naming an assignee or Notion URL
- WHEN the skill completes
- THEN no roster work page lookup or Notion publish step runs
- **Test:** `skips Notion publish when no assignee and no explicit URL` — [`src/skills/epic-narrative.test.ts`](../../../src/skills/epic-narrative.test.ts)

### Requirement: Cascade Unchanged

Sprint cascade behavior SHALL remain unchanged.

#### Scenario: Sprint cascade independent [tested]

- GIVEN a sprint narrative run with diff changes
- WHEN `cascade_epic_notion_updates` runs
- THEN it continues to derive targets from the sprint diff without relying on the epic narrative skill publish step
- **Test:** `does not alter sprint cascade workflow` — [`src/skills/epic-narrative.test.ts`](../../../src/skills/epic-narrative.test.ts)
