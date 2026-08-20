# Agentic Harness

An infrastructure layer for building LLM-driven automation. A single agent with a unified tool registry interprets natural language requests, loads workflow recipes on demand, and orchestrates multi-step pipelines — while structural guardrails keep the LLM within configured boundaries.

Currently wired to Jira, Slack, and Notion via their hosted MCP servers. The architecture is service-agnostic: adding a new integration means building tools, not changing infrastructure.

## Quick start

```bash
npm install
```

### Configuration

Copy the example configs and fill in your values:

```bash
cp src/config/jira.example.json src/config/jira.json
cp src/config/roster.example.json src/config/roster.json
```

**`src/config/jira.json`** — Jira connection and scope:
```json
{
  "cloudId": "your-cloud-id",
  "projects": ["PROJECT1", "PROJECT2"],
  "fields": { "sprint": "customfield_10021" },
  "roster": ["First Last", "Another Person"],
  "issueLinkBase": "https://your-org.atlassian.net/browse/",
  "narrative": { "descriptionLimit": 1000 }
}
```

**`src/config/models.json`** — model selection per capability (committed, no secrets):
```json
{
  "default": "gpt-4o",
  "agents": { "agent": "gpt-4o" },
  "tools": {
    "generate_epic_narrative": "gpt-4o",
    "generate_sprint_narrative": "gpt-4o"
  }
}
```

Create a `.env` file with your keys:
```bash
OPENAI_API_KEY=sk-...
SLACK_CLIENT_ID=your-slack-app-client-id
SLACK_CLIENT_SECRET=your-slack-app-client-secret
```

### Authentication

Each service authenticates independently via OAuth. The first connection opens a browser:

```bash
npm run auth -- jira     # Atlassian OAuth flow
npm run auth -- slack    # Slack OAuth flow
npm run auth -- notion   # Notion OAuth flow
npm run check -- jira    # verify Jira connection
npm run check -- slack   # verify Slack connection
npm run check -- notion  # verify Notion connection
```

See the detailed setup guides: [Jira](docs/jira-setup.md) | [Slack](docs/slack-setup.md) | [Notion](docs/notion-setup.md)

### Usage

```bash
npm run agent -- "what's the team's progress this sprint"
npm run agent -- "what's Alice working on this sprint"
npm run agent -- "generate an epic narrative for PROJ-100"
npm run agent -- "add Bob Chen to the roster"
npm run agent -- "send Alice a Slack message with the sprint report"
npm run agent -- "publish the sprint report to Notion under https://notion.so/workspace/Reports-abc123"
```

Pipe output to a file:
```bash
npm run agent -- "what's the team's progress this sprint" > output/sprint.md
```

Timing and tool calls are logged to stderr. The narrative goes to stdout.

### Tracing

Every run logs LLM round-trip times and tool execution times to stderr:

```
  [llm]  turn 1 — 4823ms → load_skill, resolve_assignees
  [tool] load_skill({"name":"sprint-narrative"}) — 1ms
  [tool] resolve_assignees({"filter":"roster"}) — 312ms
```

For full traces (prompts, responses, tool results):

```bash
AGENT_TRACE=1 npm run agent -- "your prompt" > output/result.md
```

Trace files are written to `output/traces/<timestamp>.ndjson`.

## How it works

The agent receives a natural language request and decides how to handle it. For multi-step workflows, it loads a **skill** — a markdown file with step-by-step instructions — and follows it exactly. For simple questions, it uses tools directly.

A sprint narrative, for example, runs through nine turns:

```
load_skill            → step-by-step recipe
resolve_assignees     → resolve names to account IDs
build_sprint_jql      → construct the search query
search_jira_issues    → fetch issues from Jira
jira_search_snapshots → diff against last cached run
jira_search_snapshots → save current snapshot
group_issues          → group by epic and status
generate_sprint_narrative → LLM writes prose, code assembles markdown
done
```

Tools return **summaries** to the LLM (e.g. "Found 27 issues across 6 epics") while full payloads stay in an internal log. Downstream tools read structured data from the log directly — the LLM never relays raw data.

See [`openspec/specs/harness-architecture/spec.md`](openspec/specs/harness-architecture/spec.md) for the full design philosophy.

## Project structure

```
src/
├── agent/          Agent orchestration (system prompt, registry)
├── config/         Runtime config (jira.json gitignored, examples committed)
├── lib/            Shared infrastructure (agent loop, cache, LLM, models)
├── prompts/        LLM system prompts for single-task agents
├── scripts/        CLI entry points
├── skills/         Multi-step workflow recipes (loaded on demand)
└── tools/
    ├── jira/       Jira tools (search, group, narrative, snapshots, etc.)
    ├── slack/      Slack tools (user search, messaging)
    ├── notion/     Notion tools (fetch, create, update pages)
    ├── roster/     Team roster management
    └── skills/     The load_skill tool
```

### Tools

| Tool | Type | Description |
|------|------|-------------|
| `resolve_assignees` | Pure | Match names to Jira account IDs via roster |
| `build_sprint_jql` | Pure | Construct sprint search query from config |
| `build_epic_jql` | Pure | Construct epic search query |
| `search_jira_issues` | External | Search Jira via MCP, parse results |
| `search_users` | External | Look up Jira users by name |
| `jira_search_snapshots` | Local I/O | Cache snapshots with diff, save, compact |
| `group_issues` | Pure | Group issues by epic, status, assignee |
| `generate_sprint_narrative` | Composite | LLM prose + deterministic markdown assembly |
| `generate_epic_narrative` | Composite | LLM prose + deterministic markdown assembly |
| `search_slack_users` | External | Search Slack users by name or email |
| `send_slack_message` | External | Send a Slack message or DM; supports `contentFrom` to forward prior tool output |
| `fetch_notion_page` | External | Fetch a Notion page's content as markdown |
| `create_notion_page` | External | Create a child page under a parent; supports `contentFrom` |
| `update_notion_page` | External | Replace a page's content; supports `contentFrom` |
| `read_roster` | Local I/O | Read team roster from disk |
| `write_roster` | Local I/O | Add/remove roster entries |
| `load_skill` | Local I/O | Load a workflow recipe by name |

### Skills

| Skill | Workflow |
|-------|----------|
| `sprint-narrative` | Resolve team → search → diff cache → group → generate |
| `epic-narrative` | Search epic + children → diff cache → group by status → generate |
| `roster` | Search users → read roster → write roster |

## Tests

```bash
npm test              # run all tests
npm run test:watch    # watch mode
```

164 tests covering tool logic, markdown assembly, cache operations, agent loop mechanics, skill loading, and execute-level flows with mocked LLM responses. No tests make live LLM or network calls.

## Utility scripts

```bash
npm run check -- jira            # verify Jira MCP connection
npm run check -- slack           # verify Slack MCP connection
npm run check -- notion          # verify Notion MCP connection
npm run auth -- jira             # Jira OAuth flow
npm run auth -- slack            # Slack OAuth flow
npm run auth -- notion           # Notion OAuth flow
npm run auth:force -- jira       # clear tokens and re-authenticate
npm run tools -- jira            # list available MCP tools
npm run tools -- jira --verbose  # list tools with full parameter schemas
```
