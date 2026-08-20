# Notion Pages

## Intent

Add the ability to create and update Notion pages through the harness. A user should be able to say "publish the sprint report to Notion under this page" and the agent creates a child page with the narrative content. They should also be able to say "update this Notion page with the latest epic status" and the agent replaces or patches the page content.

All content is markdown-formatted. The agent never sees the Notion MCP directly.

## Scope

- Fetch a Notion page by URL or ID (read its markdown content)
- Create a new page under a parent page (given as a URL)
- Update an existing page (given as a URL) — full content replace for MVP
- Support `contentFrom` to forward prior tool output (e.g. narratives) directly to Notion

## Out of scope

- Database operations (querying, creating rows, filtering views)
- Block-level targeted edits (search-and-replace on specific sections) — deferred post-MVP
- Comments, attachments, file uploads
- Page deletion or archival
- Templates and page properties beyond title
- Notion search (finding pages by keyword)
