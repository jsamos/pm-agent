# Meeting PPOA — Transcript Fetch Foundation

## Intent

Add the first building block for the **meeting-ppoa** skill: fetch a meeting transcript from a Notion page URL so the agent can produce a four-section PPOA summary. Most runs will start from a Notion transcript page the user links.

## Scope

- New `fetch_notion_transcript` harness tool — wraps Notion MCP fetch, returns clean transcript text
- `extractTranscriptText` helper — strips Notion metadata boilerplate from fetched markdown
- CLI script to verify live fetch against a user-supplied URL
- Register `meeting-ppoa` skill in orchestrator index; add numbered workflow step to call `fetch_notion_transcript` when a Notion URL is provided

## Out of scope (follow-up changes)

- LLM PPOA generation tool or prompt file
- Notion publish flow (create child page, nest source under Transcript heading)
- Enrich PPOA from secondary sources (Jira, etc.)
