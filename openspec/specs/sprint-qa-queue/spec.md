# Sprint QA Queue in Assignee Narrative

## Purpose

In assignee-grouped **sprint narratives**, surface dev-assigned QA-status tickets in QA engineers' **Not Started** sections (their queue) instead of the original developer's **In Motion** section. QA engineers' own QA-status tickets remain **In Motion**.

Jira assignees are not changed. Existing assignee-based QA language hints are unchanged. Epic narrative is out of scope.

## Requirements

### Requirement: Assignee Sprint View Only

The system SHALL apply QA queue rebucketing only when the sprint narrative uses assignee as the outer group.

#### Scenario: Assignee-grouped sprint narrative [tested]

- GIVEN `group_issues` was called with `groupBy` starting with `"assignee"` (including after upgrade to `["assignee", "status", "epic"]`)
- WHEN `generate_sprint_narrative` runs
- THEN QA queue rebucketing is applied before LLM calls
- **Test:** `applies QA queue rebucket after assignee grouping upgrade` — [`src/tools/jira/generate-sprint-narrative.test.ts`](../../../src/tools/jira/generate-sprint-narrative.test.ts)

#### Scenario: Epic-grouped sprint narrative [tested]

- GIVEN `group_issues` was called with `groupBy: ["epic", "status"]`
- WHEN `generate_sprint_narrative` runs
- THEN grouping is unchanged by QA queue rebucketing
- **Test:** `leaves epic-first grouping unchanged` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)

### Requirement: Queue Identification

The system SHALL treat an issue as a QA queue candidate when its Jira status is QA and its assignee does not have the `qa` roster role.

#### Scenario: Dev-assigned QA ticket [tested]

- GIVEN an issue with status `"QA"` assigned to a roster member without `qa` role
- WHEN QA queue rebucketing runs
- THEN the issue is a queue candidate
- **Test:** `moves dev-assigned QA tickets to QA engineer Not Started and removes from developer In Motion` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)

#### Scenario: QA engineer assigned QA ticket [tested]

- GIVEN an issue with status `"QA"` assigned to a roster member with `qa` role
- WHEN QA queue rebucketing runs
- THEN the issue is NOT a queue candidate
- AND it remains in the QA assignee's `in_progress` bucket
- **Test:** `keeps QA-assigned QA tickets in QA engineer In Motion` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)

#### Scenario: Non-QA status [tested]

- GIVEN an issue not in QA status
- WHEN QA queue rebucketing runs
- THEN the issue is not moved
- **Test:** `does not move non-QA status tickets` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)

### Requirement: Move to QA Not Started

The system SHALL move each queue candidate into the `not_started` bucket of every roster member with the `qa` role who has an assignee section in the narrative (or receives a section because of queue items).

#### Scenario: Queue item under QA engineer [tested]

- GIVEN a queue candidate for issue `PROJ-100` under parent epic `EPIC-1`
- AND roster member Bob Chen has `roles: ["qa"]`
- WHEN rebucketing completes
- THEN the issue appears in Bob's `not_started` sub-group for epic `EPIC-1`
- **Test:** `moves dev-assigned QA tickets to QA engineer Not Started and removes from developer In Motion` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)

#### Scenario: QA engineer active QA work unchanged [tested]

- GIVEN Bob Chen has `roles: ["qa"]` and an issue in QA status assigned to Bob
- WHEN rebucketing completes
- THEN that issue remains in Bob's `in_progress` bucket
- **Test:** `keeps QA-assigned QA tickets in QA engineer In Motion` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)

### Requirement: Deduplicate from Developer Section

The system SHALL remove queue candidates from the original assignee's `in_progress` bucket.

#### Scenario: Removed from developer In Motion [tested]

- GIVEN Alice Martin (no `qa` role) has issue `PROJ-100` in QA status in her `in_progress` bucket
- WHEN rebucketing completes
- THEN `PROJ-100` is not in Alice's `in_progress` bucket
- AND `PROJ-100` appears only under QA assignee queue section(s)
- **Test:** `moves dev-assigned QA tickets to QA engineer Not Started and removes from developer In Motion` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)

### Requirement: Synthetic QA Assignee Group

The system SHALL ensure a QA-role roster member appears as an outer assignee group when they have queue items but no directly assigned sprint tickets.

#### Scenario: QA engineer with queue only [tested]

- GIVEN Bob Chen has `roles: ["qa"]` and no issues assigned to Bob in the sprint search result
- AND at least one queue candidate exists
- WHEN rebucketing completes
- THEN an outer assignee group for Bob Chen exists
- AND queue candidates appear in Bob's `not_started` sections
- **Test:** `creates QA engineer outer group when they only have queue items` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)

### Requirement: Epic Sub-Grouping Preserved

When grouping includes epic as the inner key, the system SHALL preserve epic sub-groups when moving queue candidates.

#### Scenario: Queue item epic placement [tested]

- GIVEN grouping is `assignee → status → epic`
- AND a queue candidate belongs to epic `EPIC-1`
- WHEN the issue is moved to a QA assignee's `not_started` bucket
- THEN it is placed under the `EPIC-1` epic sub-group, not a flat status list
- **Test:** `places queue items under the correct epic sub-group` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)

### Requirement: QA Language Hints Unchanged

The system SHALL NOT add viewer-aware QA hint variants. Existing assignee-based hints apply to rebucketed issues.

#### Scenario: Queue item hints use ticket assignee [tested]

- GIVEN a queue candidate assigned to Alice Martin (no `qa` role) appears in Bob Chen's Not Started LLM batch
- WHEN `buildQaLanguageHints` runs for that batch
- THEN the issue is classified as awaiting QA based on Alice's assignee role
- AND no new hint block keyed to the narrative section owner is added
- **Test:** `classifies queue items by ticket assignee not section owner` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)

### Requirement: No Epic Narrative Impact

Epic narrative generation SHALL NOT apply QA queue rebucketing.

#### Scenario: Epic narrative unchanged [tested]

- GIVEN `generate_epic_narrative` runs after assignee-filtered or unfiltered epic grouping
- WHEN narrative sections are built
- THEN QA queue rebucketing is not applied
- **Test:** `leaves epic-first grouping unchanged` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)

### Requirement: Composable Grouping

The `group_issues` tool SHALL remain unchanged. Rebucketing is an internal step in `generate_sprint_narrative`.

#### Scenario: group_issues output preserved in log [tested]

- GIVEN the agent called `group_issues` then `generate_sprint_narrative`
- WHEN rebucketing runs
- THEN the stored `group_issues` tool result in the call log is not mutated
- AND rebucketing operates on a copy used only for narrative generation
- **Test:** `does not mutate the input grouped result` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)

### Requirement: Multiple QA Engineers

When multiple roster members have the `qa` role, each SHALL receive the full dev-assigned QA queue in their Not Started sections.

#### Scenario: Shared queue across QA engineers [tested]

- GIVEN Bob Chen and Carol Diaz both have `roles: ["qa"]`
- AND one queue candidate exists
- WHEN rebucketing completes
- THEN the candidate appears in Not Started for both Bob's and Carol's assignee sections
- **Test:** `adds the full queue to each QA engineer section` — [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts)
