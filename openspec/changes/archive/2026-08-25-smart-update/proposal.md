# Smart Sprint Report Updates

## Intent

When regenerating a sprint report, only re-run LLM calls for groups whose tickets actually changed since the last run. Cache per-group prose after each generation so unchanged groups can be reused instantly. When publishing to Notion, replace the full page with the assembled narrative (cached sections + regenerated sections).

This reduces LLM cost and latency proportionally to how much of the sprint actually changed between runs — most mid-sprint updates touch 1–3 groups out of 5–8 total.

## Scope

- Narrative cache: persist per-group prose and rendered markdown after each sprint narrative generation, keyed by JQL thread hash
- Narrative cache management: list, count, remove, compact, and clear cached entries via `jira_narrative_cache`
- Selective regeneration: cross-reference the snapshot diff's changed issue keys against each group's issue keys to decide which groups need LLM calls
- Notion full-page update: replace the entire page body with the assembled narrative via `replace_content`
- Override: user can say "regenerate" / "full" to bypass the cache and force full regeneration

## Out of scope

- Epic narrative selective regeneration (can extend later using the same cache pattern)
- Notion surgical section updates (`update_content` / `insert_content` pairs) — full replace is simpler and sufficient
- Caching across different `groupBy` modes (cache is invalidated when groupBy changes)
