# Epic Narrative Roster Work Page Publish

## Intent

When a user requests an assignee-filtered epic narrative (e.g. "generate an epic narrative for PROJ-100 for Alice Martin"), automatically look up that person's roster `workPages` mapping for the epic and publish the generated narrative to Notion — the same page the sprint cascade would update.

## Scope

- New `resolve_epic_work_page` tool: `(accountId, epicKey)` → roster work page URL or `"not created"`
- Epic narrative skill: after `generate_epic_narrative`, call `update_notion_page` when a work page is resolved
- Explicit Notion URL in the user prompt overrides roster lookup
- Unmapped work pages: still generate narrative; report `"not created"` (do not fail)
- Diff gate unchanged: unchanged diff STOP skips narrative and Notion update

## Out of scope

- Auto-creating Notion pages or writing URLs back to roster
- Multi-epic requests where epics map to different work pages (use first epic key for lookup; document limitation)
- Standalone publish without running the epic narrative pipeline
- Changes to sprint cascade or `generate_epic_narrative` tool logic
