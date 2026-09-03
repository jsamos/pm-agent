# Epic Narrative Work Page Publish — Design

Depends on: `resolve_assignees`, `resolve_epic_work_page` (new), `generate_epic_narrative`, `update_notion_page`, `findWorkPageEntry` in `src/lib/roster-work-pages.ts`.

## Flow

```
User: "generate epic narrative for PROJ-100 for Alice"
  → resolve_assignees(["Alice"])           → accountId
  → resolve_epic_work_page(accountId, PROJ-100)  → pageUrl | not created
  → build_epic_jql → search → diff/save → group → generate_epic_narrative
  → update_notion_page(pageUrl, contentFrom: generate_epic_narrative)  [if mapped]
```

Explicit Notion URL in prompt → skip `resolve_epic_work_page`, use URL in final step.

## Helper: `resolveEpicWorkPage`

Location: `src/lib/roster-work-pages.ts`

```typescript
export interface EpicWorkPageResolution {
  found: true;
  pageUrl: string;
  name?: string;
  epics: string[];
  displayName: string;
} | {
  found: false;
  reason: "not created" | "assignee not on roster";
}

function resolveEpicWorkPage(
  entries: RosterEntry[],
  accountId: string,
  epicKey: string,
): EpicWorkPageResolution
```

Uses existing `findWorkPageEntry`. First epic key from user request when multiple epics (MVP).

## Tool: `resolve_epic_work_page`

Location: `src/tools/roster/resolve-epic-work-page.ts`

Parameters: `accountId` (required), `epicKey` (required).

Loads roster via `loadRosterFile()`, delegates to helper. No side effects.

Register in `src/agent/registry.ts`.

## Skill update

`src/skills/epic-narrative.md`:

1. After `resolve_assignees` (when assignee specified): call `resolve_epic_work_page` unless user gave explicit Notion URL.
2. After step 6 `generate_epic_narrative`: step 7 publish when work page resolved or explicit URL; note `"not created"` when assignee specified but unmapped.

Diff STOP branch unchanged — no publish.

## Files

| File | Change |
|------|--------|
| `src/lib/roster-work-pages.ts` | `findRosterEntryByAccountId`, `resolveEpicWorkPage` |
| `src/lib/roster-work-pages.test.ts` | Resolution scenarios |
| `src/tools/roster/resolve-epic-work-page.ts` | New tool |
| `src/tools/roster/resolve-epic-work-page.test.ts` | Tool execute tests |
| `src/tools/roster/index.ts` | Export |
| `src/agent/registry.ts` | Register tool |
| `src/skills/epic-narrative.md` | Lookup + publish steps |
| `src/skills/epic-narrative.test.ts` | Skill workflow parser tests |
| `openspec/specs/epic-narrative-work-page/spec.md` | Canonical spec |

No changes: `generate-epic-narrative.ts`, `cascade-epic-notion.ts`.

## Documentation

### README.md

- Epic narrative usage: assignee-filtered runs publish to roster work page when mapped
- Add `resolve_epic_work_page` to tools table
- Add [`epic-narrative-work-page`](openspec/specs/epic-narrative-work-page/spec.md) to behavioral specs table

### Spec scenario tags

When implementation and tests land, update **both** spec copies:

- [`openspec/specs/epic-narrative-work-page/spec.md`](../../specs/epic-narrative-work-page/spec.md)
- [`openspec/changes/epic-narrative-work-page/specs/epic-narrative-work-page/spec.md`](specs/epic-narrative-work-page/spec.md)

### Scenario → test mapping

| Spec scenario | Test title | File |
|---------------|------------|------|
| Mapped work page found | `returns work page URL for mapped epic on roster member` | [`src/lib/roster-work-pages.test.ts`](../../../src/lib/roster-work-pages.test.ts) |
| Epic not mapped on member | `returns not created when epic is not on member work pages` | [`src/lib/roster-work-pages.test.ts`](../../../src/lib/roster-work-pages.test.ts) |
| Assignee not on roster | `returns assignee not on roster when account ID is unknown` | [`src/lib/roster-work-pages.test.ts`](../../../src/lib/roster-work-pages.test.ts) |
| Assignee with mapped work page | `resolves roster work page after assignee resolution and publishes after narrative` | [`src/skills/epic-narrative.test.ts`](../../../src/skills/epic-narrative.test.ts) |
| Explicit Notion URL overrides roster | `skips roster lookup when user provides explicit Notion URL` | [`src/skills/epic-narrative.test.ts`](../../../src/skills/epic-narrative.test.ts) |
| Assignee without work page mapping | `notes not created when assignee work page is unmapped` | [`src/skills/epic-narrative.test.ts`](../../../src/skills/epic-narrative.test.ts) |
| Unchanged diff stops before publish | `stops before narrative and Notion when diff is unchanged` | [`src/skills/epic-narrative.test.ts`](../../../src/skills/epic-narrative.test.ts) |
| No assignee — no roster publish | `skips Notion publish when no assignee and no explicit URL` | [`src/skills/epic-narrative.test.ts`](../../../src/skills/epic-narrative.test.ts) |
| Sprint cascade independent | `does not alter sprint cascade workflow` | [`src/skills/epic-narrative.test.ts`](../../../src/skills/epic-narrative.test.ts) |
