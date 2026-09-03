# Roster Work Page Management

## Purpose

Manage per-member Notion work page mappings in `roster.json`: link Jira epic keys to Notion page URLs, optionally label pages with a human-readable name, and add or remove epic keys without deleting the whole mapping. Work pages are consumed by [epic Notion cascade](epic-notion-cascade/spec.md).

The agent composes existing roster tools — `resolve_assignees` for member identity, `read_roster` for inspection, `write_roster` for mutations. Member names MUST NOT be resolved inside `write_roster`.

## Requirements

### Requirement: Work Page Shape

The system SHALL store work page mappings on roster entries with a Notion URL, optional display name, and epic key list.

#### Scenario: Work page with name [tested]

- GIVEN a roster entry with a work page `{ page, name, epics }`
- WHEN read_roster is called
- THEN the entry includes `page`, `name`, and `epics` for that work page
- **Test:** `returns notion, slack, and workPages for each resolved entry` — [`src/tools/roster/read.test.ts`](../../../src/tools/roster/read.test.ts)

#### Scenario: Work page without name [tested]

- GIVEN a roster entry with a work page `{ page, epics }` and no `name`
- WHEN read_roster is called
- THEN the work page is returned without a `name` field
- AND cascade and lookup behavior is unchanged
- **Test:** `add_work_page appends a new page entry` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

#### Scenario: Page URL is identity key [tested]

- GIVEN two mutation calls for the same member and the same `page` URL
- WHEN add_work_page runs twice
- THEN a single work page entry exists for that URL
- AND epic keys are merged into one `epics` array
- **Test:** `add_work_page keeps a single entry when called twice for the same URL` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

### Requirement: Add Work Page

The system SHALL add or update a work page mapping via `write_roster` action `add_work_page`.

#### Scenario: New work page [tested]

- GIVEN a roster member and a Notion page URL not yet on that member
- WHEN write_roster is called with action `add_work_page`, `accountId`, `page`, `epics` (non-empty), and optional `name`
- THEN a new work page entry is appended with `page`, `epics`, and `name` when provided
- **Test:** `add_work_page appends a new page entry with name` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

#### Scenario: Merge epics on existing URL [tested]

- GIVEN a member already has a work page for `page`
- WHEN write_roster is called with action `add_work_page`, the same `page`, and additional epic keys
- THEN the existing entry's `epics` array includes all prior and new keys (deduplicated)
- AND `name` is updated when provided in the call
- **Test:** `add_work_page merges epics and updates name when page URL already exists` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

#### Scenario: Missing page or epics [tested]

- GIVEN action `add_work_page`
- WHEN `page` is empty or `epics` is missing or empty
- THEN the mutation fails with a clear error
- AND roster file is not modified
- **Test:** `add_work_page fails when page or epics are missing` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

#### Scenario: Member not on roster [tested]

- GIVEN an `accountId` not in the roster
- WHEN write_roster is called with action `add_work_page`
- THEN the mutation fails
- AND roster file is not modified
- **Test:** `add_work_page fails when page or epics are missing` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

### Requirement: Remove Epics From Work Page

The system SHALL remove individual epic keys from a work page via `write_roster` action `remove_epics_from_work_page`.

#### Scenario: Partial epic removal [tested]

- GIVEN a work page with epics `["PROJ-100", "PROJ-200"]`
- WHEN write_roster is called with action `remove_epics_from_work_page`, matching `page` ref, and `epics: ["PROJ-100"]`
- THEN the entry's `epics` is `["PROJ-200"]`
- AND the work page entry remains
- **Test:** `remove_epics_from_work_page removes listed epics and keeps the entry` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

#### Scenario: Remove last epic [tested]

- GIVEN a work page with a single epic key
- WHEN write_roster is called with action `remove_epics_from_work_page` removing that epic
- THEN the work page entry is removed from the member
- AND `workPages` is omitted when the member has no remaining work pages
- **Test:** `remove_epics_from_work_page removes entry when last epic is removed` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

#### Scenario: Epic not on page [tested]

- GIVEN a work page that does not list the requested epic key
- WHEN remove_epics_from_work_page is called for that epic
- THEN the mutation succeeds
- AND `epics` is unchanged
- **Test:** `remove_epics_from_work_page succeeds when epic is not on the page` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

#### Scenario: Work page not found [tested]

- GIVEN a `page` reference that matches neither a stored URL nor a stored `name` for that member
- WHEN remove_epics_from_work_page is called
- THEN the mutation fails with a clear error
- **Test:** `remove_epics_from_work_page fails when work page ref is not found` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

### Requirement: Set Work Page Name

The system SHALL set a human-readable label via `write_roster` action `set_work_page_name`.

#### Scenario: Set name on existing page [tested]

- GIVEN a member has a work page identified by URL
- WHEN write_roster is called with action `set_work_page_name`, `accountId`, `page`, and non-empty `name`
- THEN the matched entry's `name` is set to the given value
- **Test:** `set_work_page_name sets display name on matched page` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

#### Scenario: Missing name [tested]

- GIVEN action `set_work_page_name`
- WHEN `name` is empty or omitted
- THEN the mutation fails
- **Test:** `set_work_page_name fails when name is empty` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

### Requirement: Remove Work Page

The system SHALL remove an entire work page mapping via `write_roster` action `remove_work_page`.

#### Scenario: Remove by URL [tested]

- GIVEN a member has a work page for a URL
- WHEN write_roster is called with action `remove_work_page` and that URL as `page`
- THEN the work page entry is removed
- **Test:** `remove_work_page removes by page URL` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

#### Scenario: Remove by display name [tested]

- GIVEN a member has a work page with `name` set
- WHEN write_roster is called with action `remove_work_page` and `page` equal to that name (case-insensitive)
- THEN the work page entry is removed
- **Test:** `remove_work_page removes by display name` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

### Requirement: Page Reference Resolution

Work page mutations that target a single page (`remove_work_page`, `remove_epics_from_work_page`, `set_work_page_name`) SHALL resolve `page` by URL first, then by display name.

#### Scenario: Match by URL [tested]

- GIVEN a work page stored with a Notion URL
- WHEN a mutation is called with `page` equal to that URL
- THEN the correct entry is selected
- **Test:** `matches work page by URL` — [`src/lib/roster-work-pages.test.ts`](../../../src/lib/roster-work-pages.test.ts)

#### Scenario: Match by name [tested]

- GIVEN a work page with `name: "Platform Epic"`
- WHEN a mutation is called with `page: "platform epic"`
- THEN the correct entry is selected
- **Test:** `matches work page by display name case-insensitively` — [`src/lib/roster-work-pages.test.ts`](../../../src/lib/roster-work-pages.test.ts)

#### Scenario: URL preferred over name collision [tested]

- GIVEN a work page whose URL string equals another entry's `name` (edge case)
- WHEN a mutation is called with that string
- THEN URL match wins
- **Test:** `prefers URL match over name match when both could apply` — [`src/lib/roster-work-pages.test.ts`](../../../src/lib/roster-work-pages.test.ts)

### Requirement: Duplicate Epic Warning

The system SHOULD warn when adding an epic that is already mapped on a different work page for the same member.

#### Scenario: Epic already on another page [tested]

- GIVEN member has work page A with epic `PROJ-100` and work page B without `PROJ-100`
- WHEN add_work_page adds `PROJ-100` to work page B
- THEN the mutation succeeds
- AND the result includes a warning that `PROJ-100` was already mapped on page A
- **Test:** `add_work_page warns when epic is already mapped on another page` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)

### Requirement: Composable Agent Flow

The roster skill SHALL instruct the agent to resolve member names before writing work pages.

#### Scenario: Named member in user request [tested]

- GIVEN the user names a roster member (e.g. "Jane") but not their account ID
- WHEN the agent updates work pages
- THEN resolve_assignees is called first to obtain `accountId`
- AND write_roster is called with that `accountId`
- **Test:** `instructs resolve_assignees before write_roster for work page updates` — [`src/skills/roster.test.ts`](../../../src/skills/roster.test.ts)

#### Scenario: Inspect before edit [tested]

- GIVEN the user asks to change an existing mapping
- WHEN the agent needs to confirm current epics or names
- THEN read_roster MAY be called before write_roster
- **Test:** `allows read_roster before write_roster when confirming mappings` — [`src/skills/roster.test.ts`](../../../src/skills/roster.test.ts)

### Requirement: Preserve Other Roster Fields

Work page mutations SHALL NOT alter unrelated fields on the roster entry or other members.

#### Scenario: Other publishing config preserved [tested]

- GIVEN a member with `notion`, `slack`, and `workPages`
- WHEN any work page action succeeds
- THEN `notion` and `slack` on that member are unchanged
- AND other members in the roster are unchanged
- **Test:** `work page mutations preserve notion and slack on the member` — [`src/tools/roster/roster.test.ts`](../../../src/tools/roster/roster.test.ts)
