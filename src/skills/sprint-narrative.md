---
name: sprint-narrative
description: Sprint status report or progress narrative
---

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
     c. If the user explicitly asked to regenerate ALL narrative prose from scratch ("regenerate", "rerun", "refresh narrative", "ignore cache"): call jira_narrative_cache({ action: "remove_thread" }) to discard cached prose, then continue to step 5.
        Do NOT call remove_thread when the user only asked to "full rewrite" or "full replace" a Notion page — that means replace the page body in step 7, and selective narrative cache still applies.
  5. Call group_issues EXACTLY ONCE with one of these groupings:
     - Default: group_issues({ groupBy: ["epic", "status"] })
     - Per-person view (user asks "by assignee", "by person", "by team member", or "assignee then epic"): group_issues({ groupBy: ["assignee", "status", "epic"] })
       REQUIRED when the user mentions both assignee and epic. Do NOT use ["assignee", "status"] alone — that skips epic sub-headings.
     Do NOT call group_issues twice. Pick one grouping based on the user's request.
  6. Call generate_sprint_narrative EXACTLY ONCE to write the prose narrative.
     Do NOT call it again in the same run — even if a prior call returned an error. For Notion or Slack, use contentFrom: "generate_sprint_narrative" on the destination tool — that forwards the narrative already generated.
     The tool automatically caches per-group prose and reuses unchanged groups on subsequent runs.
     When tickets change, only affected groups are regenerated — the rest come from cache.
  7. (Optional) If the user provides a Notion page URL for an existing report, call update_notion_page with contentFrom: "generate_sprint_narrative" (do NOT call generate_sprint_narrative again). The assembled narrative combines cached and freshly regenerated sections — the full page is replaced in Notion.
  8. cascade_epic_notion_updates — call once when the diff showed changes (or first run with no baseline). Runs after generate_sprint_narrative (and after optional sprint Notion update in step 7). Skips epic×assignee pairs with no workPages mapping (logs "not created"). Fails only if a derived assignee is not on the roster. Skips work pages with no open issues; logs unassigned changed tickets.
