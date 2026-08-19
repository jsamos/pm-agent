Sprint narrative (follow this order EXACTLY):
  1. resolve_assignees to get account IDs
  2. build_sprint_jql to construct the query
     - Consider the user's intent: are they asking about everything in the sprint, or only the unfinished portion? If the focus is on what's not yet done, pass excludeClosed: true.
  3. search_jira_issues to fetch issues (pass resolveParentsTo: "Epic")
  4. jira_search_snapshots({ action: "diff" }) — MUST come BEFORE save
     Read the diff summary, then decide:
     a. If "No changes since …": reply with that exact summary and STOP. Include the baseline timestamp and the number of issues checked. Do NOT call save, group_issues, or generate_sprint_narrative.
     b. If changed or first run: reply noting what changed (e.g. "3 added, 1 status change since 2026-08-17T14:30"), then call jira_search_snapshots({ action: "save" }) and continue to step 5.
     c. If the user explicitly said "regenerate" / "rerun" / "refresh": skip diff, go straight to step 5.
  5. group_issues({ groupBy: ["epic", "status"] }) to group by epic then status
     - For per-person view: group_issues({ groupBy: ["assignee", "status"] })
  6. generate_sprint_narrative to write the prose narrative
