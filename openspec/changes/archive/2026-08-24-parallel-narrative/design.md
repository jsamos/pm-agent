# Parallel Narrative Generation

**Status: Archived**

## Addendum: Divergences from original design

- The orchestrator skill (`sprint-narrative.md`) needed an explicit "call group_issues EXACTLY ONCE" instruction to prevent the LLM from calling it twice (once per grouping mode) in a single run.
- 3rd-level grouping (`["assignee", "status", "epic"]`) was implemented by flattening into (assignee × epic) units — one LLM call per unit. The assembly renders epic sub-headings deterministically. Relying on the LLM to organize by epic from tags alone proved unreliable.
- `search_jira_issues` was updated to auto-read JQL from the last `build_sprint_jql` or `build_epic_jql` result in the tool call log, preventing the orchestrator LLM from corrupting account IDs when re-typing the query.

## Architecture

Current flow:
```
group_issues result → build one big user message → one LLM call → parse { groups: [...] } → assembleMarkdown
```

New flow:
```
group_issues result → build N user messages (one per group) → N parallel LLM calls → parse N { groupKey, delivered, inProgress, notStarted } → collect into array → assembleMarkdown
```

## Changes to `generate_sprint_narrative.ts`

### Per-group user message

Extract the existing per-group data formatting into a function `buildGroupMessage(group, outerKey, jiraBase, descLimit)` that returns a string containing:
- The group key and label
- Status sub-sections with issues
- When status sub-groups have their own sub-groups (3rd level), include labeled sub-sections and a note to organize prose by sub-section

### Per-group LLM call

Each call sends:
- **System prompt**: Same `sprint-narrative.md` prompt, unchanged
- **User message**: Single group's data with a preamble like `"Write prose for this single group."`

### Response format per call

Each call returns:
```json
{
  "groupKey": "Alice Martin",
  "delivered": ["paragraph"],
  "inProgress": ["paragraph per epic theme"],
  "notStarted": ["paragraph"]
}
```

No `{ groups: [...] }` wrapper — just the inner object.

### Parallel execution

```ts
const results = await Promise.all(
  grouped.groups.map((group) => generateForGroup(group, ...))
);
```

Each `generateForGroup` builds the user message, calls the LLM, parses the JSON response, and returns a `GroupNarrative`. On parse failure, it logs a warning and returns a fallback with empty arrays.

### Assembly

`assembleMarkdown` receives the collected `GroupNarrative[]` exactly as before. No changes needed.

## Changes to `sprint-narrative.md` (system prompt)

Update the response format section to describe a single group response instead of an array:

```
Return a JSON object for this group:
{
  "groupKey": "...",
  "delivered": ["..."],
  "inProgress": ["..."],
  "notStarted": ["..."]
}
```

The `groups` array wrapper is removed since each call handles one group.

## 3rd-level sub-sections (epic within assignee)

When a status sub-group has its own sub-groups (e.g. `["assignee", "status", "epic"]`), the per-group user message includes labeled sub-sections:

```
In Progress (4):
  [Clean Claims | Frontend Setup] (3):
    - PROJ-100 ...
  [DSO Requests] (1):
    - PROJ-200 ...
```

And a note: `"Write one paragraph per labeled sub-section within each status."`

Since each call is isolated, this instruction only appears in calls that actually have sub-sections.

## Tests

- Existing `assembleMarkdown` tests remain unchanged (assembly input/output is the same)
- Update execute-level tests to verify parallel calls are made (mock `context.llm.generate` and check call count matches group count)
- Test that individual group parse failures don't crash the whole narrative

## Files to modify

- `src/tools/jira/generate-sprint-narrative.ts` — refactor execute, extract `buildGroupMessage` and `generateForGroup`
- `src/prompts/sprint-narrative.md` — update response format from array to single object
- `src/tools/jira/generate-sprint-narrative.test.ts` — update execute-level tests
