# Notion Setup

This harness connects to Notion through Notion's hosted MCP server. Authentication uses OAuth — no API keys, app creation, or client credentials needed.

## Prerequisites

- A Notion account with access to the workspace you want to read/write
- Node.js 18+

## 1. Authenticate

Run the auth script — it will open a browser for Notion's OAuth flow:

```bash
npm run auth -- notion
```

You'll be asked to grant access to your Notion workspace. After authorizing, tokens are cached locally in `~/.mcp-auth/`.

## 2. Verify

```bash
npm run check -- notion
```

This connects to the Notion MCP server and lists available tools. If it succeeds, you're ready to go.

## Usage

The agent exposes three Notion tools:

| Tool | Description |
|------|-------------|
| `fetch_notion_page` | Read a page's content as markdown |
| `create_notion_page` | Create a child page under a parent |
| `update_notion_page` | Replace a page's content |

All tools accept Notion URLs or raw page IDs. For example:

```bash
npm run agent -- "publish the sprint report to Notion under https://notion.so/workspace/Reports-abc123"
npm run agent -- "update this Notion page with the latest epic status: https://notion.so/workspace/Epic-def456"
```

Tools also support `contentFrom` to forward the output of a prior tool (e.g. a narrative) directly as page content — the agent handles this automatically.

## Troubleshooting

**"Connection closed" or timeout during auth:**
Clear cached tokens and try again:

```bash
rm -rf ~/.mcp-auth
npm run auth -- notion
```

**Permission errors:**
The OAuth flow grants access based on your Notion account's permissions. Make sure you can access the target pages in Notion's web UI.

**"Notion MCP returned no text content":**
The MCP call succeeded but returned an unexpected format. Check the trace (`AGENT_TRACE=1`) for the raw response.
