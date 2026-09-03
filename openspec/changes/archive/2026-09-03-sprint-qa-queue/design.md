# Sprint QA Queue — Design

Depends on: `group_issues`, `generate_sprint_narrative`, `roster.json` roles (`qa`), existing `isQaStatus` / `assigneeHasRole` in `src/lib/roster-roles.ts`.

## Problem

```
group_issues (assignee → status → epic)
  status bucket = Jira statusCategory
  QA status → statusCategory "In Progress" → in_progress everywhere
```

Developer Alice with a ticket in QA → Alice / In Motion. QA engineer Bob never sees it unless assigned to him.

## Desired behavior (assignee sprint view only)

```
Before rebucket:
  Alice / In Motion: PROJ-100 (QA, assignee Alice)
  Bob / In Motion:   PROJ-200 (QA, assignee Bob)

After rebucket:
  Alice / In Motion: (PROJ-100 removed)
  Bob / Not Started: PROJ-100 (still assignee Alice in Jira data)
  Bob / In Motion:   PROJ-200
```

QA language hints unchanged — PROJ-100 still has assignee Alice → "awaiting QA" phrasing when Bob's unit is generated.

## Architecture

```
group_issues (assignee …)
  → upgradeAssigneeGrouping (existing)
  → applyQaQueueRebucket(grouped, roster)   ← NEW
  → flattenToEpicUnits / cache / LLM calls (existing)
```

Do **not** mutate `group_issues` tool output in the log — rebucket inside `generate_sprint_narrative` on a local copy so the tool layer stays dumb and composable.

## Helper: `applyQaQueueRebucket`

Location: `src/lib/roster-roles.ts` (or `src/lib/sprint-qa-queue.ts` if roster-roles grows too large).

```typescript
function applyQaQueueRebucket(
  grouped: GroupIssuesResult,
  roster: RosterEntry[],
): GroupIssuesResult
```

**Preconditions** — return `grouped` unchanged when:

- `grouped.groupBy[0] !== "assignee"`
- No roster members with `roles` including `"qa"`
- No issues with QA status in the grouped tree

**Algorithm**

1. Collect all issues in the grouped tree (or from parallel issue list).
2. Identify **queue candidates**: `isQaStatus(status)` AND assignee does NOT have `qa` role.
3. Identify **QA assignee keys**: roster members with `qa` role whose `displayName` / `shortName` / `name` match an assignee group key, **plus** any QA roster member who needs a synthetic outer group (see below).
4. For each queue candidate:
   - Remove from original assignee's `in_progress` sub-group (and epic sub-sub-group when present).
   - Append to each QA assignee's `not_started` sub-group under the same epic key (create sub-groups as needed).
5. Remove empty sub-groups after moves.
6. If a QA engineer has queue items but no outer assignee group, **create** an outer group `{ groupKey: displayName, groupLabel: displayName, subGroups: [...] }`.

**Multiple QA engineers**: each QA-role assignee section receives the full queue (MVP — acceptable duplication in rare multi-QA teams).

**Role lookup**: use existing `assigneeHasRole(assignee, "qa", roster)` (display-name index). Match outer groups by assignee display name consistent with `group_issues` assignee keying.

## Integration point

In `generate_sprint_narrative` `execute`, after:

```typescript
grouped = upgradeAssigneeGrouping(grouped, searchIssues);
```

add:

```typescript
if (grouped.groupBy[0] === "assignee") {
  grouped = applyQaQueueRebucket(grouped, loadRosterEntries());
}
```

Before narrative cache reuse / `flattenToEpicUnits`.

## Cache interaction

Rebucket runs **before** cache key matching. An issue moved from Alice `in_progress` to Bob `not_started` changes composite keys (`assignee::epic`); diff-based invalidation on issue keys still regens affected units. No cache schema change.

## QA hints — no change

`appendMarkdownInstructions` → `buildQaLanguageHints(issues)` classifies by **ticket assignee**, not narrative section owner:

- Queue items in Bob's Not Started (assignee Alice) → existing "awaiting QA" lines
- Bob's own QA tickets in In Motion → existing "active QA validation" lines

No viewer-aware variant.

## Files to modify

| File | Change |
|------|--------|
| `src/lib/roster-roles.ts` or `src/lib/sprint-qa-queue.ts` | `applyQaQueueRebucket` |
| `src/lib/roster-roles.test.ts` or new `sprint-qa-queue.test.ts` | Rebucket scenarios |
| `src/tools/jira/generate-sprint-narrative.ts` | Call rebucket; export helper if tested from sprint tests |
| `src/tools/jira/generate-sprint-narrative.test.ts` | Integration: section counts, dedup, synthetic QA group |
| `openspec/specs/sprint-qa-queue/spec.md` | Canonical behavioral spec |

No changes: `group-issues.ts`, `generate-epic-narrative.ts`, prompts, cascade.

## Tests

Mirror spec scenarios:

- Dev-assigned QA ticket moves to QA engineer Not Started
- Removed from developer In Motion (dedup)
- QA-assigned QA ticket stays In Motion
- No-op when groupBy is epic-first
- No-op when no QA roster members
- QA engineer outer group created when queue-only
- Non-QA assignee unchanged for non-QA statuses
- `flattenToEpicUnits` after rebucket produces expected unit buckets

## Documentation

### README.md

- Sprint narrative / roster roles: note that dev-assigned QA tickets appear in QA engineers' **Not Started** (queue), not under the developer's In Motion
- Add [`sprint-qa-queue`](openspec/specs/sprint-qa-queue/spec.md) to the behavioral specs table

### Spec scenario tags

When implementation and tests land, update **both** spec copies (canonical first, then mirror):

- [`openspec/specs/sprint-qa-queue/spec.md`](../../specs/sprint-qa-queue/spec.md)
- [`openspec/changes/sprint-qa-queue/specs/sprint-qa-queue/spec.md`](specs/sprint-qa-queue/spec.md)

| Tag | When |
|-----|------|
| `[tested]` | Automated test directly asserts scenario WHEN/THEN |
| `[manual]` | Cannot run in CI (none expected) |
| *(untagged)* | Not yet verified |

For each `[tested]` scenario, add a **Test** line with the exact `it(...)` title and a markdown link to the test file. See `AGENTS.md` for tag rules.

Do not mark `[tested]` until the linked test exists.

### Scenario → test mapping

| Spec scenario | Test title | File |
|---------------|------------|------|
| Assignee-grouped sprint narrative | `applies QA queue rebucket after assignee grouping upgrade` | [`src/tools/jira/generate-sprint-narrative.test.ts`](../../../src/tools/jira/generate-sprint-narrative.test.ts) |
| Epic-grouped sprint narrative | `leaves epic-first grouping unchanged` | [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts) |
| Dev-assigned QA ticket | `moves dev-assigned QA tickets to QA engineer Not Started and removes from developer In Motion` | [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts) |
| QA engineer assigned QA ticket | `keeps QA-assigned QA tickets in QA engineer In Motion` | [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts) |
| Non-QA status | `does not move non-QA status tickets` | [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts) |
| Removed from developer In Motion | `moves dev-assigned QA tickets to QA engineer Not Started and removes from developer In Motion` | [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts) |
| Queue item under QA engineer | `moves dev-assigned QA tickets to QA engineer Not Started and removes from developer In Motion` | [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts) |
| QA engineer with queue only | `creates QA engineer outer group when they only have queue items` | [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts) |
| Queue item epic placement | `places queue items under the correct epic sub-group` | [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts) |
| Queue item hints use ticket assignee | `classifies queue items by ticket assignee not section owner` | [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts) |
| Epic narrative unchanged | `leaves epic-first grouping unchanged` | [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts) |
| group_issues output preserved in log | `does not mutate the input grouped result` | [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts) |
| Shared queue across QA engineers | `adds the full queue to each QA engineer section` | [`src/lib/sprint-qa-queue.test.ts`](../../../src/lib/sprint-qa-queue.test.ts) |
