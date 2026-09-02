# Epic Notion Cascade from Sprint Diff

## Intent

When a sprint narrative run detects ticket changes, automatically regenerate and publish assignee epic work pages in Notion for every affected assignee×epic pair. Each roster member's Notion **homepage** and **work pages** (one page covering one or more epics) live in the roster alongside Jira identity.

The sprint diff is the sole trigger — no separate epic diff gate. Epic page content uses the **full epic view** (all non-closed child issues for that assignee), independent of any `statusCategories` filter on the sprint JQL.

## Scope

- **Extended roster**: optional `notion.homepageUrl`, `slack.channelId`, and `workPages[]` (`page` + `epics[]`) per member; `read_roster` / `write_roster` support reading and updating these fields
- **Assignee change detection**: snapshot diff gains `assigneeChanges` (like `parentChanges`); cached issues store `assigneeAccountId`
- **Cascade target derivation**: from sprint diff, compute `(assigneeAccountId, epicKey)` pairs including reassignment and parent-change side effects
- **Target resolution**: skip and log targets whose epic has no matching `workPages` entry (reason: `"not created"`); fail the run only if a derived assignee is not on the roster
- **Cascade execution**: new tool runs epic narrative generation + Notion full-page replace for each resolved work page; skips pages with no open work; logs unassigned tickets
- **Sprint skill update**: after sprint diff shows changes, run sprint narrative generation first, then cascade epic Notion page updates
- **Reporting**: structured summary of updated, skipped, not created, and logged items

## Out of scope

- Epic narrative section cache / selective regen (deferred; full LLM call per page for MVP)
- Standalone "refresh all epic pages" without sprint diff (deferred)
- Auto-creating Notion pages or persisting URLs from `create_notion_page` (manual roster config only)
- Slack notifications on cascade (roster `slack.channelId` is schema-only for now)
- Sprint Notion page updates (unchanged; epic cascade is additive)
- Surgical Notion section updates — full `replace_content` only
