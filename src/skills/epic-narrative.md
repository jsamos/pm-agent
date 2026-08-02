Epic narrative (follow this order EXACTLY):
  1. If assignee specified: resolve_assignees first to get the account ID
  2. build_epic_jql with epic keys (and the resolved account ID if filtering)
  3. search_jira_issues to fetch the epic and its children
  4. jira_search_snapshots({ action: "diff" }) — MUST come BEFORE save
     Read the diff summary, then decide:
     a. If "No changes since …": reply with that exact summary and STOP. Include the baseline timestamp and the number of issues checked. Do NOT call save, group_issues, or generate_epic_narrative.
     b. If changed or first run: reply noting what changed, then call jira_search_snapshots({ action: "save" }) and continue to step 5.
     c. If the user explicitly said "regenerate" / "rerun" / "refresh": skip diff, go straight to step 5.
  5. group_issues({ groupBy: "status" }) to bucket into Done / In Motion / Not Started
  6. generate_epic_narrative to write the prose narrative
