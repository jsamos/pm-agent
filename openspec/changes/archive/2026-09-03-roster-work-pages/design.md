# Roster Work Page Management — Design

Depends on: `read_roster`, `write_roster`, `resolve_assignees`, epic cascade (`findWorkPageEntry` in `src/lib/roster-work-pages.ts`).

## Architecture

Composable orchestration — no name resolution inside write:

```
User: "add work page … for Jane, epic PROJ-100"
  → resolve_assignees({ filter: ["Jane"] })     → accountId
  → read_roster()                                → optional confirm
  → write_roster({ action: "add_work_page", accountId, page, name?, epics })
```

```
User: "remove PROJ-100 from Platform Epic"
  → resolve_assignees([...])                     → accountId
  → write_roster({ action: "remove_epics_from_work_page", accountId, pageRef, epics })
```

All mutations go through `applyRosterWrite` in `src/tools/roster/mutations.ts` (tested without tool I/O).

## Schema

```typescript
interface RosterWorkPage {
  page: string;       // Notion URL — identity key
  name?: string;      // human label, e.g. "Platform Epic"
  epics: string[];    // Jira epic keys covered by this page
}
```

Example:

```json
{
  "page": "https://www.notion.so/workspace/Platform-Epic-000000000001",
  "name": "Platform Epic",
  "epics": ["PROJ-100"]
}
```

Backward compatible: existing entries without `name` continue to work.

## Work page lookup (`pageRef`)

New helper in `src/lib/roster-work-pages.ts` (or colocated with mutations):

```typescript
function findWorkPageByRef(entry: RosterEntry, pageRef: string): RosterWorkPage | undefined
```

Match order:

1. Exact match on `page` (trimmed)
2. Case-insensitive exact match on `name` (if set)

Used by `remove_epics_from_work_page`, `set_work_page_name`, and optionally `remove_work_page` (accept `page` or `pageRef` param — same field, documented as URL or name).

If no match: `{ success: false, message: "Work page not found …" }`.

## `write_roster` action matrix

| Action | Required args | Behavior |
|--------|---------------|----------|
| `add_work_page` | `accountId`, `page`, `epics[]` | New entry `{ page, epics, name? }`. If URL exists: merge epics (dedupe), set `name` if provided. |
| `remove_work_page` | `accountId`, `page` | Remove entire entry (match URL or `name` via pageRef). Unchanged semantics. |
| `remove_epics_from_work_page` | `accountId`, `page`, `epics[]` | Remove listed keys from matched entry. If `epics` empty afterward, remove entry (same as `remove_work_page`). |
| `set_work_page_name` | `accountId`, `page`, `name` | Set `name` on matched entry. `name` required, non-empty. |

Parameter naming: keep `page` as the tool field name; description documents it accepts URL or display name.

### Duplicate epic warning

On `add_work_page`, before merge:

- For each epic in `input.epics`, if another work page on the same member already lists that epic, collect warnings.
- Still apply the mutation (last write wins for cascade lookup — `findWorkPageEntry` returns first match; document that duplicates are discouraged).
- Return `{ success: true, message, warning?: string }`.

Optional follow-up: make duplicate a hard error — deferred; warning only for MVP.

## Files to modify

| File | Change |
|------|--------|
| `src/tools/roster/types.ts` | Add optional `name` to `RosterWorkPage` |
| `src/tools/roster/mutations.ts` | New actions; extend `add_work_page`; `pageRef` lookup; duplicate warning |
| `src/tools/roster/write.ts` | Enum + params (`name`); update description |
| `src/lib/roster-work-pages.ts` | `findWorkPageByRef`; export for mutations/tests |
| `src/tools/roster/roster.test.ts` | Scenarios for new actions |
| `src/lib/roster-work-pages.test.ts` | `findWorkPageByRef` cases |
| `src/skills/roster.md` | Work page management steps |
| `src/config/roster.example.json` | Sample `name` on work page |
| `openspec/specs/roster-work-pages/spec.md` | Canonical behavioral spec |

No registry changes (same tools). Epic cascade unchanged — `findWorkPageEntry` ignores `name`.

## Tests

Mirror spec scenarios in `roster.test.ts` and `roster-work-pages.test.ts`:

- `add_work_page` with `name` on create and on merge
- `remove_epics_from_work_page` partial and empty-entry removal
- `set_work_page_name` on URL and via name ref
- `remove_work_page` via name ref
- pageRef not found → failure
- duplicate epic warning on add
- `set_roles` / other actions preserve `name`

Skill test (`sprint-narrative.test.ts` pattern): optional parser test on `roster.md` asserting work-page compose instructions if we add structured skill tests later — not required for MVP unless skill file changes are scenario-tagged.

## Documentation

- Update `README.md` roster section: `name` field, new actions, example utterances

### Spec scenario tags

When implementation and tests land, update **both** spec copies (canonical first, then mirror to the change copy):

- [`openspec/specs/roster-work-pages/spec.md`](../../specs/roster-work-pages/spec.md)
- [`openspec/changes/roster-work-pages/specs/roster-work-pages/spec.md`](specs/roster-work-pages/spec.md)

| Tag | When |
|-----|------|
| `[tested]` | An automated test directly asserts the scenario's WHEN/THEN |
| `[manual]` | True end-to-end behavior that cannot run in CI (none expected for this change) |
| *(untagged)* | Not yet verified — remove only when shipping incomplete work |

For each `[tested]` scenario, add a **Test** line with the exact `it(...)` title (or `describe` title if the whole block maps to one scenario) and a markdown link to the test file. Edit the canonical spec first, then mirror to the change copy.

Example (after tests exist):

```markdown
#### Scenario: New work page [tested]

- GIVEN a roster member and a Notion page URL not yet on that member
- WHEN write_roster is called with action `add_work_page`, `accountId`, `page`, `epics` (non-empty), and optional `name`
- THEN a new work page entry is appended with `page`, `epics`, and `name` when provided
- **Test:** `add_work_page appends a new page entry with name` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)
```

Do not mark `[tested]` until the linked test exists and asserts the THEN. Use `[manual]` only when CI coverage is genuinely impossible — not as a shortcut for skipped tests.

### Scenario → test mapping (fill in at ship time)

| Spec scenario | Test title | File |
|---------------|------------|------|
| Work page with name | *(it title)* | [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts) |
| New work page | *(it title)* | [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts) |
| Merge epics on existing URL | *(it title)* | [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts) |
| Partial epic removal | *(it title)* | [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts) |
| Remove last epic | *(it title)* | [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts) |
| Set name on existing page | *(it title)* | [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts) |
| Remove by display name | *(it title)* | [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts) |
| Match by URL / Match by name | *(it title)* | [`src/lib/roster-work-pages.test.ts`](../../../src/lib/roster-work-pages.test.ts) |
| Epic already on another page | *(it title)* | [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts) |
| Named member in user request | *(it title)* | [`src/skills/roster.md`](../../../src/skills/roster.md) or skill test file |
| Other publishing config preserved | *(it title)* | [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts) |

Replace *(it title)* with the actual `it('…')` string when tagging scenarios.

