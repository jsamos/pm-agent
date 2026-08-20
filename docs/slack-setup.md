# Slack Setup

This harness connects to Slack through Slack's hosted MCP server. Unlike Jira (which supports dynamic client registration), Slack requires you to create a Slack app first and provide its OAuth credentials.

## Prerequisites

- A Slack workspace where you have permission to install apps
- Node.js 18+

## 1. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**
3. Name your app (e.g. "PM Harness") and select your workspace
4. Click **Create App**

## 2. Enable MCP server access

1. In your app's settings, navigate to **Agent & AI Tools** (in the left sidebar)
2. Toggle on **MCP Server Access**

Without this step, authentication will succeed but the connection will fail with "App is not enabled for Slack MCP server access."

## 3. Configure OAuth redirect

1. In your app's settings, navigate to **OAuth & Permissions**
2. Under **Redirect URLs**, add:

```
http://localhost:3334/oauth/callback
```

3. Click **Save URLs**

The harness pins the OAuth callback to port 3334. This redirect URL must match exactly.

## 4. Get your credentials

1. In your app's settings, go to **Basic Information**
2. Under **App Credentials**, copy:
   - **Client ID**
   - **Client Secret**

## 5. Add credentials to `.env`

Add both values to your `.env` file in the project root:

```
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
```

The harness reads these at runtime. They are never committed to the repo (`.env` is gitignored).

## 6. Authenticate

Run the auth script — it will open a browser window for Slack OAuth:

```bash
npm run auth -- slack
```

You'll be asked to authorize the app for your workspace. The requested scopes include channels, messaging, user search, and file access. After authorizing, tokens are cached locally in `~/.mcp-auth/`.

## 7. Verify

```bash
npm run check -- slack
```

This connects to Slack's MCP server and lists available tools. If it succeeds, you're ready to go.

## How it works

The harness uses `@automattic/mcp-remote` to connect to Slack's hosted MCP server at `mcp.slack.com`. Because Slack uses static OAuth (not dynamic client registration), your app's Client ID and Secret are passed to `mcp-remote` at connection time.

The harness tools (`search_slack_users`, `send_slack_message`) wrap the raw MCP calls with parsing and error handling. The Slack MCP returns markdown-formatted responses — the tools parse these into structured data.

## Troubleshooting

**"App is not enabled for Slack MCP server access":**
Go to your app's **Agent & AI Tools** page and enable the MCP toggle (step 2 above).

**"Connection closed" during auth:**
Verify the redirect URL in your Slack app matches `http://localhost:3334/oauth/callback` exactly. Also ensure port 3334 is not in use by another process.

**User search returns no results:**
Slack's MCP search matches on display name, not necessarily full legal name. Try searching by first name only — the harness automatically retries with the first name if a multi-word query returns no results.

**"SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must be set":**
Make sure your `.env` file exists in the project root and contains both values. The harness loads it via `dotenv`.

**Re-authenticating:**
Clear cached tokens and start over:

```bash
rm -rf ~/.mcp-auth
npm run auth -- slack
```
