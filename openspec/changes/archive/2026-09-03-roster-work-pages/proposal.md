# Roster Work Page Management

## Intent

Let users manage per-member Notion **work page** mappings through natural language — add a page URL and epic keys for a roster member, add or remove individual epics from an existing page, set a human-readable name, or remove a mapping entirely.

Work pages drive [epic Notion cascade](openspec/specs/epic-notion-cascade/spec.md). Today `write_roster` supports `add_work_page` (merge epics by URL) and `remove_work_page` (delete entire entry), but not epic-level removal, display names, or lookup by name. The agent skill does not document the full compose flow.

This change extends the existing roster write surface — no new tools — and adds optional `name` on each work page entry.

## Scope

- **Schema**: optional `name` on `RosterWorkPage`; `page` URL remains the stable identity key
- **`write_roster` actions**:
  - extend `add_work_page` with optional `name` (create, merge epics, or update name on existing URL)
  - **`remove_epics_from_work_page`** — remove listed epic keys; delete entry if `epics` becomes empty
  - **`set_work_page_name`** — set or replace display name on an existing entry
  - `remove_work_page` unchanged (remove entire entry by URL)
- **`pageRef` resolution**: work-page mutations accept a reference that matches either the stored `page` URL or `name` (case-insensitive exact match on name)
- **Duplicate epic warning**: when adding epics, if the same epic key is already mapped on another work page for that member, return success with a `warning` (do not fail)
- **Pure mutation helpers** in `mutations.ts` + tests; **`read_roster`** returns `name` when present
- **Roster skill** update: compose `resolve_assignees` → `read_roster` (optional) → `write_roster`
- **`roster.example.json`**: show `name` on a sample work page entry

## Out of scope

- New standalone tool (e.g. `manage_work_pages`) — extend `write_roster` only
- Name resolution for roster **members** inside `write_roster` — agent MUST call `resolve_assignees` first (composable tools rule)
- Notion page creation or URL normalization (`create_notion_page` + manual `add_work_page` remains the flow)
- Jira epic validation (existence, assignee ownership) — dumb roster I/O only
- Changes to epic cascade execution logic (consumes existing `page` + `epics`; ignores `name`)
- Bulk import from crawl drafts (`output/notion-roster-draft.json`)
- Enforcing one-epic-per-page or global uniqueness across roster members
