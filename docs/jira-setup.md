# Jira Setup

This harness connects to Jira through Atlassian's hosted MCP server. Authentication uses OAuth — no API tokens or service accounts needed.

## Prerequisites

- A Jira Cloud instance (e.g. `your-org.atlassian.net`)
- An Atlassian account with access to the projects you want to query
- Node.js 18+

## 1. Find your Cloud ID

Visit this URL in a browser while logged into your Atlassian account:

```
https://your-org.atlassian.net/_edge/tenant_info
```

Copy the `cloudId` field from the JSON response.

## 2. Create the config file

```bash
cp src/config/jira.example.json src/config/jira.json
```

Fill in your values:

```json
{
  "cloudId": "your-cloud-id-here",
  "projects": ["PROJ1", "PROJ2"],
  "fields": { "sprint": "customfield_10021" },
  "roster": ["First Last", "Another Person"],
  "issueLinkBase": "https://your-org.atlassian.net/browse/",
  "narrative": { "descriptionLimit": 1000 }
}
```

| Field | Purpose |
|-------|---------|
| `cloudId` | Your Atlassian Cloud ID (from step 1) |
| `projects` | Jira project keys to include in queries |
| `fields.sprint` | Custom field ID for the sprint field (usually `customfield_10021`) |
| `roster` | Team member names for bulk lookups |
| `issueLinkBase` | Base URL for issue links in narratives |
| `narrative.descriptionLimit` | Max characters of issue description sent to the LLM (default: 1000) |

## 3. Set up the roster

```bash
cp src/config/roster.example.json src/config/roster.json
```

The roster maps short names to Jira account IDs. You can populate it manually or use the agent:

```bash
npm run agent -- "add Alice Martin to the roster"
```

The agent will search Jira for the user, find their account ID, and save the mapping.

## 4. Authenticate

Run the auth script — it will open a browser window for Atlassian OAuth:

```bash
npm run auth -- jira
```

You'll be asked to grant access to your Atlassian account. After authorizing, the tokens are cached locally in `~/.mcp-auth/`.

## 5. Verify

```bash
npm run check -- jira
```

This connects to the MCP server and lists available tools. If it succeeds, you're ready to go.

## Troubleshooting

**"Connection closed" or timeout during auth:**
Clear cached tokens and try again:

```bash
npm run auth:force -- jira
```

**Sprint field not found:**
The sprint custom field ID varies by instance. Check your Jira admin settings or query an issue's fields to find the correct ID.

**No issues returned:**
Verify that `projects` in `jira.json` matches your actual Jira project keys, and that the authenticated user has access to those projects.
