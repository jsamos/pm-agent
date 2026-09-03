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
cp src/config/bedrock.example.json src/config/bedrock.json
```

**`src/config/bedrock.json`** — Bedrock model map (copy from example, set ARNs for your AWS account):
```json
{
  "default": "sonnet-4.6",
  "models": {
    "sonnet-4.6": {
      "label": "Claude Sonnet 4.6",
      "bedrockModelId": "anthropic.claude-sonnet-4-6",
      "inferenceProfileArn": "arn:aws:bedrock:us-east-1:ACCOUNT:application-inference-profile/..."
    }
  }
}
```

Run `npm run bedrock:models` to list keys, labels, and ARNs. Inference profile ARNs are **account-specific** — copy from SSM for the same AWS account as `AWS_PROFILE`:

```bash
aws ssm get-parameters-by-path --path "/developer/bedrock" --recursive \
  --with-decryption --region us-east-1 --profile YOUR_PROFILE --output json
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

**`src/config/models.json`** — host-agnostic logical model names and routing (committed, no secrets):

```json
{
  "default": "gpt-4o",
  "agents": { "agent": "gpt-4o" },
  "tools": {
    "generate_epic_narrative": {
      "model": "sonnet-4.6",
      "maxTokens": 8192,
      "temperature": 0.3
    },
    "generate_sprint_narrative": {
      "model": "sonnet-4.6",
      "maxTokens": 8192,
      "temperature": 0.3
    }
  },
  "routes": {
    "gpt-4o": { "provider": "openai", "modelId": "gpt-4o" },
    "sonnet-4.6": { "provider": "bedrock", "modelId": "sonnet-4.6" }
  }
}
```

Tool entries MAY be a string (model name only) or an object with `model`, `maxTokens`, and `temperature`. Invoke settings apply to inner narrative LLM calls; the orchestrator uses the agent/default model only.

**Logical names** (`sonnet-4.6`, `gpt-4o`) are what code and config reference — not provider-specific IDs. The **`routes`** table maps each name to a provider and `modelId`:

| Provider | `modelId` meaning |
|----------|-------------------|
| `openai` | OpenAI API model string |
| `bedrock` | Key in gitignored `bedrock.json` (resolved to an inference profile ARN at call time) |

`createLLM` returns a **routing LLM**: one shared `context.llm` delegates each call to the correct backend based on `options.model`. A typical multi-model run uses **gpt-4o for the orchestrator** (tool-use workflow) and **Bedrock Sonnet for narrative tools** (prose generation) — configured separately under `agents` and `tools`.

See [`openspec/specs/model-routing/spec.md`](openspec/specs/model-routing/spec.md) for the full behavioral spec.

**`src/config/roster.json`** — team identity and optional publishing config (gitignored; copy from `roster.example.json`):

```json
{
  "resolved": [
    {
      "name": "Jane Smith",
      "shortName": "Jane",
      "accountId": "712020:00000000-0000-0000-0000-000000000001",
      "displayName": "Jane Smith",
      "notion": { "homepageUrl": "https://www.notion.so/workspace/Jane-Hub-..." },
      "slack": { "channelId": "C01234567" },
      "workPages": [
        { "page": "https://www.notion.so/workspace/Platform-Epic-...", "name": "Platform Epic", "epics": ["PROJ-100"] }
      ]
    }
  ],
  "unresolved": [],
  "generatedAt": "2026-01-01T00:00:00.000Z"
}
```

- **`notion.homepageUrl`** — optional person hub page (not used by cascade today).
- **`slack.channelId`** — optional DM/channel target for future Slack publish flows.
- **`workPages`** — maps one or more Jira epic keys to a Notion page URL, with an optional `name` for human reference. Required for [epic cascade](#epic-notion-cascade) to update assignee epic work pages after a sprint run. Manage via `write_roster` actions: `add_work_page`, `remove_epics_from_work_page`, `set_work_page_name`, `remove_work_page`.
- **`roles`** — optional tags such as `"qa"`. In assignee-grouped sprint narratives, dev-assigned tickets in QA status appear in QA engineers' **Not Started** (queue), not under the developer's In Motion. Set via `write_roster` `set_roles`.

Create a `.env` file with your keys:

```bash
cp .env.example .env
# edit .env — see placeholders and comments in .env.example
```

### LLM rate limiting

Sprint narrative generation fires many parallel LLM calls (one per epic or assignee group). On lower OpenAI tiers that can burst past your org's **tokens-per-minute (TPM)** limit and return 429 errors.

When `OPENAI_TPM_LIMIT` is set, all **OpenAI-routed** LLM calls in a single agent run share one rolling 60-second token budget. Bedrock-routed calls are not charged against the OpenAI bucket. The harness applies pacing in `createLLM` (via `createHarnessContext`) before the instance reaches the agent loop or tools.

Before each OpenAI call the harness **reserves** an estimated token count; after the call it records actual usage from the response and adjusts the reservation. If the window is full, it waits until older usage expires:

```
  [llm] TPM wait — 12.3s (28000/30000 used, reserving ~3000)
```

When `OPENAI_TPM_LIMIT` is **unset**, there is no proactive pacing — OpenAI calls go out as fast as the agent requests them. Reactive 429 retry still applies via `withRateLimitRetry` (respecting `retry-after-ms` headers when present).

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_TPM_LIMIT` | unset (off) | Your org TPM cap for OpenAI-routed calls. |
| `LLM_TOKEN_ESTIMATE` | `3000` | Tokens reserved before each OpenAI call starts. |
| `LLM_MAX_RETRIES` | `5` | Max reactive retries on HTTP 429 after pacing. |

**Recommended for tier-1 accounts:**

```bash
OPENAI_TPM_LIMIT=30000
```

Use whatever limit matches your [OpenAI org rate limits](https://platform.openai.com/docs/guides/rate-limits). The orchestrator and all inner narrative calls draw from the same budget — you do not need separate concurrency settings.

See [`openspec/specs/llm-rate-limit/spec.md`](openspec/specs/llm-rate-limit/spec.md) for the full behavioral spec.

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
npm run agent -- "what's the sprint status by assignee, then epic"
npm run agent -- "what's Alice working on this sprint"
npm run agent -- "generate an epic narrative for PROJ-100"
npm run agent -- "generate an epic narrative for PROJ-100 for Alice Martin"
npm run agent -- "add Bob Chen to the roster"
npm run agent -- "send Alice a Slack message with the sprint report"
npm run agent -- "publish the sprint report to Notion under https://notion.so/workspace/Reports-abc123"
```

When the sprint diff shows changes, the agent also runs **`cascade_epic_notion_updates`** to refresh mapped epic work pages in Notion (see [Epic Notion cascade](#epic-notion-cascade) below).

Assignee-filtered epic narratives (e.g. "for Alice Martin") publish to that person's roster **work page** when the epic is mapped — same URL the cascade uses. Unmapped epics still generate narrative output with a `"not created"` note.

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
  [narrative] Alice Martin / PROJ-100 — 8421ms
  [tool] cascade_epic_notion_updates({}) — 102566ms
```

For full traces (prompts, responses, tool results):

```bash
AGENT_TRACE=1 npm run agent -- "your prompt" > output/result.md
```

Trace files are written to `output/traces/<timestamp>.ndjson`.

## How it works

The agent receives a natural language request and decides how to handle it. For multi-step workflows, it loads a **skill** — a markdown file with step-by-step instructions — and follows it exactly. For simple questions, it uses tools directly.

A sprint narrative, for example, follows the `sprint-narrative` skill:

```
load_skill                  → step-by-step recipe
resolve_assignees           → resolve names to account IDs
build_sprint_jql            → construct the search query
search_jira_issues          → fetch issues (resolveParentsTo: "Epic")
jira_search_snapshots       → diff against last cached run
  (stop if unchanged — no narrative, no cascade)
jira_search_snapshots       → save current snapshot
group_issues                → group by epic/status or assignee/status/epic
generate_sprint_narrative   → LLM writes prose; code assembles markdown
update_notion_page          → optional: publish sprint report to Notion
cascade_epic_notion_updates → when diff showed changes: refresh mapped epic work pages
done
```

If the user asks to regenerate all sprint prose from scratch, the skill may call `jira_narrative_cache({ action: "remove_thread" })` before grouping. Sprint narrative reuse is per-group — see [`openspec/specs/smart-update/spec.md`](openspec/specs/smart-update/spec.md).

Tools return **summaries** to the LLM (e.g. "Found 27 issues across 6 epics") while full payloads stay in an internal log. Downstream tools read structured data from the log directly — the LLM never relays raw data.

See [`openspec/specs/harness-architecture/spec.md`](openspec/specs/harness-architecture/spec.md) for the full design philosophy.

### Epic Notion cascade

After a sprint run with **changes** (or a first run with no baseline), `cascade_epic_notion_updates` derives `(assignee, epic)` pairs from the sprint diff, looks up each pair in roster `workPages`, and for each mapped Notion page:

```
build_epic_jql → search_jira_issues → jira_search_snapshots save
  → group_issues(status) → generate_epic_narrative → update_notion_page
```

Behavior:

- **Unmapped epics** — skipped; logged as `"not created"`.
- **Unknown assignee** (not on roster) — fails the run before any LLM/Notion calls.
- **No open work** on a mapped page — skipped with reason `"no open work"`.
- **Unchanged sprint diff** — cascade is not run (skill stops at the diff step).

Configure epic→page mappings in `roster.json` (`workPages`). See [`openspec/specs/epic-notion-cascade/spec.md`](openspec/specs/epic-notion-cascade/spec.md).

## Project structure

```
src/
├── agent/          Agent orchestration (system prompt, registry)
├── config/         Runtime config (jira.json gitignored, examples committed)
├── lib/            Shared infrastructure (agent loop, cache, createLLM, models)
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
| `jira_narrative_cache` | Local I/O | Per-group sprint narrative prose cache (list, remove, compact) |
| `group_issues` | Pure | Group issues by epic, status, assignee |
| `generate_sprint_narrative` | Composite | LLM prose + deterministic markdown assembly |
| `generate_epic_narrative` | Composite | LLM prose + deterministic markdown assembly |
| `cascade_epic_notion_updates` | Composite | After sprint diff: refresh roster-mapped epic work pages in Notion |
| `search_slack_users` | External | Search Slack users by name or email |
| `send_slack_message` | External | Send a Slack message or DM; supports `contentFrom` to forward prior tool output |
| `fetch_notion_page` | External | Fetch a Notion page's content as markdown |
| `create_notion_page` | External | Create a child page under a parent; supports `contentFrom` |
| `update_notion_page` | External | Replace a page's content; supports `contentFrom` |
| `read_roster` | Local I/O | Read team roster (identity, roles, notion, slack, workPages) |
| `resolve_epic_work_page` | Local I/O | Look up roster work page URL for assignee + epic |
| `write_roster` | Local I/O | Add/remove members; set roles, notion, slack; manage work page mappings (add/remove epics, rename) |
| `load_skill` | Local I/O | Load a workflow recipe by name |

### Skills

| Skill | Workflow |
|-------|----------|
| `sprint-narrative` | Resolve team → search → diff → save → group → generate → optional Notion → epic cascade |
| `epic-narrative` | Resolve assignee + work page → search epic → diff cache → group by status → generate → optional Notion publish |
| `roster` | Search users → read roster → write roster (including workPages for cascade) |

## Tests

```bash
npm test              # run all tests
npm run test:watch    # watch mode
```

Tests cover tool logic, markdown assembly, cache operations, the agent loop, skill loading, selective regeneration, epic Notion cascade, Notion update modes, LLM rate limiting, and execute-level flows with mocked LLM and MCP responses. No tests make live LLM or network calls.

### Behavioral specs

| Spec | Topic |
|------|--------|
| [`harness-architecture`](openspec/specs/harness-architecture/spec.md) | Tool log, skills, design philosophy |
| [`smart-update`](openspec/specs/smart-update/spec.md) | Snapshot diff + selective narrative reuse |
| [`epic-notion-cascade`](openspec/specs/epic-notion-cascade/spec.md) | Roster workPages, cascade after sprint diff |
| [`epic-narrative-work-page`](openspec/specs/epic-narrative-work-page/spec.md) | Publish assignee epic narratives to roster work pages |
| [`roster-work-pages`](openspec/specs/roster-work-pages/spec.md) | Work page CRUD, display names, epic add/remove |
| [`sprint-qa-queue`](openspec/specs/sprint-qa-queue/spec.md) | QA queue in assignee sprint narratives |
| [`model-routing`](openspec/specs/model-routing/spec.md) | Logical model names and provider routes |
| [`llm-rate-limit`](openspec/specs/llm-rate-limit/spec.md) | OpenAI TPM pacing |
| [`notion-pages`](openspec/specs/notion-pages/spec.md) | Notion fetch/create/update tools |
| [`slack-messaging`](openspec/specs/slack-messaging/spec.md) | Slack user search and messaging |

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
npm run bedrock:models              # list Bedrock model keys and ARNs
npm run bedrock:ask -- 'your prompt'   # send a prompt to Bedrock (AWS SSO + .env)
```
