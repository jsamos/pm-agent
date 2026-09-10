---
name: epic-narrative
description: Epic status summary or narrative
---

Epic narrative (follow this order EXACTLY):
  1. If assignee specified: resolve_assignees first to get the account ID
     a. If the user provided a Notion page URL, skip roster lookup — use that URL in step 7.
     b. Otherwise call resolve_epic_work_page with the account ID and epic key (first key when multiple epics) to look up roster workPages.
  2. build_epic_jql with epic keys (and the resolved account ID if filtering)
  3. search_jira_issues to fetch the epic and its children
  4. jira_search_snapshots({ action: "diff" }) — MUST come BEFORE save
     Read the diff summary, then decide:
     a. If "No changes since …": reply with that exact summary and STOP. Include the baseline timestamp and the number of issues checked. Do NOT call save, group_issues, generate_epic_narrative, or update_notion_page.
     b. If changed or first run: reply noting what changed, then call jira_search_snapshots({ action: "save" }) and continue to step 5.
     c. If the user explicitly said "regenerate" / "rerun" / "refresh": skip diff, go straight to step 5.
  5. group_issues({ groupBy: "status" }) to bucket into Done / In Motion / Not Started
  6. generate_epic_narrative to write the prose narrative
  7. Publish to Notion when a page URL is available:
     a. If step 1 resolved a roster work page OR the user gave an explicit Notion URL: update_notion_page with contentFrom: "generate_epic_narrative" and that pageUrl.
     b. If assignee was specified, resolve_epic_work_page returned not found, and no explicit URL: return the narrative and note the work page is not mapped ("not created").
     c. If no assignee and no explicit URL: output narrative only (no Notion step).
