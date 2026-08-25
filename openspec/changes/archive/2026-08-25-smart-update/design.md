# Smart Sprint Report Updates — Design

## Architecture

Current flow (all groups regenerated every run):

```
search → diff → group → generate ALL groups → assemble → output
```

New flow (selective regeneration):

```
search → diff → group → load narrative cache
  → classify groups as changed/unchanged
  → generate CHANGED groups only (parallel LLM)
  → reuse UNCHANGED groups from cache
  → assemble → write narrative cache → output
```

Notion update flow:

```
generate_sprint_narrative assembles full markdown (cached + fresh sections)
  → update_notion_page(contentFrom: "generate_sprint_narrative")
  → Notion MCP replace_content({ new_str: narrative })
```

Selective regeneration saves LLM cost; Notion always gets a full page replace. No section-level diffing against the Notion page.

## New file: `src/tools/jira/narrative-cache.ts`

Cache entry structure:

```typescript
interface NarrativeCacheEntry {
  thread: string;            // MD5 of JQL (same hash as snapshot cache)
  timestamp: string;         // ISO string
  groupBy: string[];         // e.g. ["epic", "status"]
  sections: GroupSection[];
}

interface GroupSection {
  groupKey: string;          // e.g. "PROJ-100", "Alice Martin"
  groupLabel: string;
  issueKeys: string[];       // all issue keys belonging to this group
  prose: GroupNarrative;     // { groupKey, delivered?, inProgress?, notStarted? }
  renderedMarkdown: string;  // assembled markdown for this section (between --- separators)
}
```

Functions:

- `loadNarrativeCache(thread: string): NarrativeCacheEntry | null` — read `output/cache/narrative_cache.ndjson`, return most recent matching entry
- `saveNarrativeCache(entry: NarrativeCacheEntry): void` — append to the ndjson file
- `collectIssueKeys(group: IssueGroup): string[]` — recursively collect all issue keys from a group and its subgroups

Storage: `output/cache/narrative_cache.ndjson`, same append-only ndjson pattern as `jira_snapshots.ndjson`. One JSON line per entry.

## New file: `src/tools/jira/narrative-cache-tool.ts`

Tool: `jira_narrative_cache` — manage cached narrative entries (mirrors `jira_search_snapshots`):

| Action | Purpose |
|--------|---------|
| `count` | Number of cache entries |
| `list` | Timestamps, thread, groupBy, section counts |
| `remove_before` | Delete entries older than a timestamp |
| `remove_thread` | Delete all entries for a JQL thread (from arg or last search) |
| `remove` | Delete entries for thread + groupBy (from log) |
| `compact` | Keep latest entry per thread + groupBy |
| `clear` | Delete all narrative cache entries |

On "full" / "regenerate" override, the sprint-narrative skill calls `remove_thread` before generation so stale prose is discarded.

## Changes to `src/tools/jira/narrative-cache.ts`

### Selective regeneration logic

Inside `execute`, after loading the `group_issues` result and diff:

1. Compute `thread` hash from the JQL (reuse the same `md5` utility from snapshots).
2. Call `loadNarrativeCache(thread)`.
3. If cache is `null` or `groupBy` doesn't match → full regeneration (current path).
4. If cache exists:
   - Build `changedKeys = new Set([...diff.added, ...diff.removed, ...diff.statusChanges.map(s => s.key)])`.
   - Build `cachedByGroupKey = new Map(cache.sections.map(s => [s.groupKey, s]))`.
   - For each group in current `group_issues` result:
     - `groupIssueKeys = collectIssueKeys(group)`
     - If `groupIssueKeys.some(k => changedKeys.has(k))` OR `!cachedByGroupKey.has(group.groupKey)` → mark for regeneration.
     - Else → reuse `cachedByGroupKey.get(group.groupKey).prose`.
5. Run LLM calls only for groups marked for regeneration (parallel, same as today).
6. Build the prose map using a mix of fresh LLM results and cached prose.
7. Assemble markdown as usual.

### Cache write

After assembly, call `saveNarrativeCache` with the current group sections (including both fresh and reused).

## Changes to `src/tools/notion/update-page.ts`

No mode parameter. Always full replace via `replace_content`. The orchestrator passes `contentFrom: "generate_sprint_narrative"` to forward the assembled narrative.

## Changes to `src/skills/sprint-narrative.md`

Add to the existing step list:

- Clarify that "regenerate" / "rerun" / "refresh" / "full" bypasses both the snapshot diff AND the narrative cache.
- Add optional Notion update step: if the user provides a Notion page URL, call `update_notion_page` with `contentFrom: "generate_sprint_narrative"`.

## Tests

### `src/tools/jira/narrative-cache.test.ts` (new)

- `loadNarrativeCache` returns null when file doesn't exist
- `loadNarrativeCache` returns most recent matching entry
- `loadNarrativeCache` ignores entries with different thread hash
- `saveNarrativeCache` appends to file
- `collectIssueKeys` recursively collects from nested subGroups

### `src/tools/jira/generate-sprint-narrative.test.ts` (extend)

- Selective regeneration: given cache + diff with one changed key, only the affected group gets an LLM call
- Full regeneration: when no cache exists, all groups get LLM calls
- Full override: when forceRegenerate is set, cache is ignored
- GroupBy mismatch: cache with different groupBy triggers full regeneration
- Parent change: ticket moving between epics triggers regen for affected groups

### `src/tools/notion/notion.test.ts` (extend)

- `update_notion_page` calls `replace_content` MCP command with full body from contentFrom

## Files to modify

| File | Change |
|------|--------|
| `src/tools/jira/narrative-cache.ts` | **New** — cache read/write/collect/remove |
| `src/tools/jira/narrative-cache-tool.ts` | **New** — cache management tool |
| `src/tools/jira/generate-sprint-narrative.ts` | Selective regeneration, cache write |
| `src/tools/notion/update-page.ts` | Full replace only |
| `src/skills/sprint-narrative.md` | Notion update step, cache remove on "full" override |
| `src/tools/jira/narrative-cache.test.ts` | **New** — cache tests |
| `src/tools/jira/generate-sprint-narrative.test.ts` | Selective regen tests |
