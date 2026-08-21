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
     c. If the user explicitly said "regenerate" / "rerun" / "refresh": skip diff, go straight to step 5.
  5. Call group_issues EXACTLY ONCE with one of these groupings:
     - Default: group_issues({ groupBy: ["epic", "status"] })
     - Only if the user explicitly asks for a per-person/by-assignee view: group_issues({ groupBy: ["assignee", "status"] })
     Do NOT call group_issues twice. Pick one grouping based on the user's request.
  6. generate_sprint_narrative to write the prose narrative
