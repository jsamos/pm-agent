# Parallel Narrative Generation

## Intent

Split sprint narrative generation from one monolithic LLM call into N parallel calls — one per outer group (epic or assignee). Each call receives only its group's data and returns prose for that group. Assembly stitches the results together deterministically.

This eliminates format bleeding between groups (where instructions for one grouping mode leak into another) and enables per-group customization (e.g., organizing by epic within an assignee's section without affecting epic-grouped output).

## Scope

- Refactor `generate_sprint_narrative` to make one LLM call per outer group
- Run calls in parallel via `Promise.all`
- Each call returns a single `GroupNarrative` (not an array)
- When 3rd-level sub-sections exist (e.g. epic within status within assignee), include sub-section instructions only in those calls
- Assembly (`assembleMarkdown`) remains unchanged
- System prompt remains unchanged

## Out of scope

- Changing the `assembleMarkdown` function
- Changing the orchestrator or skill flow
- Changing `group_issues` behavior
- Retry/fallback for individual failed calls (deferred — log and skip)
