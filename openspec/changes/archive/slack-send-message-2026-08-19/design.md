# Slack Integration: Send a Message

**Status: Archived** — Implemented in commit `c6161fa`.

Depends on: `multi-service-mcp` (archived)

## Addendum: Divergences from original design

- **Response format:** The Slack hosted MCP returns markdown-formatted results (`{ results: "# Search Results...\nName: ...\nUser ID: ..." }`) rather than structured JSON. Parsers extract fields from markdown lines instead of object properties.
- **Error surfacing:** `callSlackTool` checks `result.isError` and throws. Parsers throw on unexpected shapes or error indicators rather than returning empty/default results. This ensures errors propagate to the LLM.
- **No `response_format: "json"` option:** Slack's MCP only supports `"detailed"` (default) and `"concise"` — both return markdown. `"concise"` strips IDs so we stick with the default.

## Architecture

Same pattern as Jira. The agent sees `search_slack_users` and `send_slack_message` — never the raw MCP.

```mermaid
flowchart LR
  Agent -->|"search_slack_users('Alice')"| SearchTool[search_slack_users]
  SearchTool -->|slack_search_users| SlackMCP[Slack MCP]
  Agent -->|"send_slack_message(userId, msg)"| SendTool[send_slack_message]
  SendTool -->|slack_send_message| SlackMCP
  SlackMCP --> SlackAPI[Slack API]
```

## Harness tools to create

### `src/tools/slack/client.ts`
Lazy MCP connection to Slack. Calls `connect("slack")`. Same pattern as `jira/client.ts`.

### `src/tools/slack/search-users.ts`
- **Type:** External
- Wraps `slack_search_users` MCP call
- Input: `{ query: string }` (name, email, etc.)
- Returns: array of `{ userId, displayName, email }` + summary string

### `src/tools/slack/send-message.ts`
- **Type:** External
- Wraps `slack_send_message` MCP call
- Input: `{ channelId: string, message: string, threadTs?: string }`
- `channelId` can be a channel ID or a user ID (for DMs)
- Returns: message link + summary

### `src/tools/slack/index.ts`
Barrel export for both tools.

## Files to modify

### `src/agent/registry.ts`
Import and register `searchSlackUsersTool` and `sendSlackMessageTool`.

### `src/prompts/orchestrator.md`
Update identity line from "access to Jira and a local team roster" to include Slack. No new skills needed — sending a message is a single-tool operation.

## Tests

- `search-users.test.ts` — test response parsing (extract userId/displayName from MCP response shape)
- `send-message.test.ts` — test input validation and response parsing

No LLM calls, no network calls. Mock the MCP client, same as Jira tests.
