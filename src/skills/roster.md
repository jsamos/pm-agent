---
name: roster
description: Team roster setup, updates, or review
---

Roster management:
  1. search_users to find account info
  2. read_roster to check current state (includes optional notion, slack, workPages per member)
  3. write_roster to update — add/remove people, set_roles, set_notion, set_slack, and work page mappings

Work page management (when the user names a roster member, call resolve_assignees first to get accountId):
  - add_work_page — page URL + epics[]; optional name (display label). Merges epics if URL already exists.
  - remove_epics_from_work_page — page URL or display name + epics[] to remove
  - set_work_page_name — page URL or display name + name
  - remove_work_page — page URL or display name (removes entire mapping)
  Use read_roster first when confirming current epics or names on existing pages.
