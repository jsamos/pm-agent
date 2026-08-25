Sprint narrative (follow this order EXACTLY):
  1. resolve_assignees to get account IDs
  2. build_sprint_jql to construct the query
     - Consider the user's intent and use statusCategories to filter accordingly:
       - Everything in the sprint → omit statusCategories
       - Remaining/unfinished work → statusCategories: ["In Progress", "To Do"]
       - Only completed work → statusCategories: ["Done"]
       - Only in-progress work → statusCategories: ["In Progress"]
  3. search_jira_issues to fetch issues (pass resolveParentsTo: "Epic")
  4. jira_search_snapshots({ action: "diff" }) — MUST come BEFORE save
     Read the diff summary, then decide:
     a. If "No changes since …": reply with that exact summary and STOP. Include the baseline timestamp and the number of issues checked. Do NOT call save, group_issues, or generate_sprint_narrative.
     b. If changed or first run: reply noting what changed (e.g. "3 added, 1 status change since 2026-08-17T14:30"), then call jira_search_snapshots({ action: "save" }) and continue to step 5.
     c. If the user explicitly said "regenerate" / "rerun" / "refresh" / "full": skip diff, call jira_narrative_cache({ action: "remove_thread" }) to discard cached prose for this query, then continue to step 5.
  5. Call group_issues EXACTLY ONCE with one of these groupings:
     - Default: group_issues({ groupBy: ["epic", "status"] })
     - Per-person view (user asks "by assignee", "by person", "by team member", or "assignee then epic"): group_issues({ groupBy: ["assignee", "status", "epic"] })
     Do NOT call group_issues twice. Pick one grouping based on the user's request.
  6. generate_sprint_narrative to write the prose narrative.
     The tool automatically caches per-group prose and reuses unchanged groups on subsequent runs.
     When tickets change, only affected groups are regenerated — the rest come from cache.
  7. (Optional) If the user provides a Notion page URL for an existing report, call update_notion_page with contentFrom: "generate_sprint_narrative". The assembled narrative combines cached and freshly regenerated sections — the full page is replaced in Notion.
