# Agentic Harness — Architecture & Philosophy

## What is a harness

A harness is reusable infrastructure that makes intelligent automation possible. It is not an agent, a workflow, or a product feature. It's the platform those things run on.

The harness provides: a tool registry, integration connections, configuration loading, caching, execution context, and conventions for how tools communicate. It doesn't know or care how work gets initiated — whether by an LLM, a script, a cron job, or a human typing a command.

An agent loop is one runtime that runs on the harness. There are others: deterministic pipelines, DAG workflows, hybrid systems that delegate one fuzzy step to an LLM, or direct scripts for testing. The harness serves all of them. Tools belong to the harness, not to any runtime.

## Design philosophy

### Let the LLM decide what varies; hardcode what doesn't

If a step always happens the same way regardless of user input, it shouldn't require an LLM decision. Make it a config value or bake it into the tool. If a step depends on interpreting user intent, that's the LLM's job.

Guardrails enforce this at two layers. First, tools: the LLM only sees the tools the harness registers. It has no knowledge of the underlying services — it calls `search_issues`, not a raw API. The tool surface is the capability boundary. Second, config: each tool reads scope constraints from config, not from the LLM. The LLM can still misinterpret intent or call tools in the wrong order, but it can't reach beyond what the tools expose or drift on the constants baked into them.

### Summaries keep the LLM informed, not overwhelmed

Tools often return large payloads. Passing all of it to the LLM wastes tokens and confuses reasoning.

The pattern: tools return a `summary` string alongside the full data. The agent loop sends only the summary to the LLM. Full results stay in an internal log.

```
Tool returns:  { items: [...50 records], summary: "Found 50 items matching your query." }
LLM sees:      "Found 50 items matching your query."
Internal log:  { tool: "search", result: { items: [...], ... } }
```

The summary updates the LLM on what happened so it can decide what to do next. The full payload is available to downstream tools through the internal log — the LLM never needs to relay it.

### The LLM should route data between tools

*North star.* The ideal: tools are fully decoupled. A tool never imports another tool. When a downstream tool needs prior data, the LLM reads the summary, decides what's next, and directs the next tool to the right prior result in the chain. The LLM is the router — it decides not just *which* tool to call, but *what data* to feed it.

This has partially diverged. Some tools currently import types and utilities from sibling tools for convenience — shared data shapes, formatting helpers. The tool call log is still the primary data-passing mechanism between pipeline steps, but compile-time coupling has crept in where the LLM should be making the routing decision. Restoring full decoupling is an ongoing tension.

### Skills are exact; tool descriptions are soft guidance

Multi-step workflows need precise ordering. LLMs are unreliable at following multi-step conditional logic from a system prompt alone, especially as that prompt grows.

The solution: workflow recipes live in separate files (skills) that the LLM loads on demand. The orchestrator's system prompt contains only response rules and a skill index. When the LLM identifies a multi-step task, its first action is to load the relevant skill, then follow its instructions exactly.

Single-tool operations skip skills entirely — the tool descriptions are sufficient for the LLM to act.

This keeps the system prompt small and token-efficient, while ensuring complex workflows execute in the right order.

### External connections are lazy and internal

Tools that need external services connect on first call. The connection is managed inside the tool, not passed in from outside. The agent loop doesn't know about connections. Tools that don't need services never pay the connection cost. Adding a new integration doesn't change the agent infrastructure.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Entry: CLI, script, or event trigger       │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│  Agent (system prompt + skill index)        │
│  - interprets intent                        │
│  - loads workflow skill if needed           │
│  - decides which tools to call              │
│  - decides when it's done                   │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│  Agent Loop                                 │
│                                             │
│  while (not done && turns < max):           │
│    1. Send messages + tool list → LLM       │
│    2. If LLM responds without tools → done  │
│    3. Execute each tool call via registry    │
│    4. Append results to message history     │
│    5. Loop                                  │
└──────────────────────┬──────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   ┌───────────┐ ┌──────────┐ ┌──────────┐
   │  Tool A   │ │  Tool B  │ │  Tool C  │
   │ (API call)│ │ (file IO)│ │ (pure fn)│
   └─────┬─────┘ └──────────┘ └──────────┘
         │
         ▼
   ┌───────────┐
   │ External  │  (any service, connected via MCP or direct API)
   │ Service   │
   └───────────┘
```

### Execution context

Every tool receives the same execution context:

- **config** — project configuration (connection identifiers, domain-specific settings, guardrail values)
- **llm** — an LLM instance, for tools that need internal sub-generation (e.g. writing prose from structured data)
- **toolCallLog** — prior tool results in the current loop, for data passing between steps

The context is the tool's window into the world. It does not contain service handles — tools manage those internally.

## Core patterns

### One agent, many tools

A single agent with a unified registry of all available tools. The LLM routes to the right tools based on the user's request. No per-task agents, no per-task scripts.

Per-task agents create artificial separation and duplicate infrastructure. The LLM is the router — it decides which tools to use based on context, not based on which binary was invoked.

### Atomic tools

Each tool does one thing. Tools own their own dependencies.

Tool categories:
- **External** — calls an API (e.g. search a project tracker, query a database)
- **Local I/O** — reads/writes local files (e.g. configuration, cached data)
- **Pure** — deterministic computation with no side effects (e.g. build a query string, format output)
- **Composite** — orchestrates other logic internally (e.g. a report generator that makes its own LLM call and assembles the final document)

### Tool call log

Downstream tools often need data from prior tool results — without the LLM re-serializing it (which would defeat the summary pattern).

The agent loop exposes the full tool call log to every tool. A tool can find prior results by tool name and read structured data directly. The LLM never touches the payload.

This is the primary decoupling mechanism. A tool doesn't call another tool — it reads from the log.

### Dynamic skills

Skills are markdown files containing step-by-step workflow recipes. The orchestrator loads them on demand via a `load_skill` tool.

The skill index lives in the system prompt. For example:
```
Available skills:
- weekly-report — Generate a weekly status report
- onboarding — Set up a new team member
- incident-review — Summarize a production incident
```

For multi-step workflows, the LLM's first call is always `load_skill`. For single-tool operations, no skill is needed.

### Memory

The harness provides persistence across runs. An agent can snapshot its current state, compare against a prior snapshot, and decide whether to regenerate or report "no changes." This is the foundation for stateful automation — recurring reports that only do work when something has changed, and eventually, agents that build on each other's prior output.

Currently this is implemented as cache tools that the agent calls explicitly. The LLM decides *whether* to cache (a recurring report yes, an ad-hoc question no); the tool handles *how*. This extends to operations like diffing and compacting. The broader ambition is shared memory across agents — not just within a single loop, but across independent runs that contribute to a common picture.

### Model configuration

Models are configured centrally, not scattered across tool code. Different capabilities have different reasoning demands — the orchestrator may need a stronger model than a utility tool. Centralizing model selection means upgrades don't touch agent or tool code.

### Tracing

The agent loop logs LLM round-trip times and tool execution times to stderr on every run:

```
  [llm]  turn 1 — 4823ms → load_skill, search_users
  [tool] load_skill({"name":"weekly-report"}) — 1ms
  [tool] search_users({"filter":"team-a"}) — 312ms
  [llm]  turn 2 — 5102ms → build_query
  [tool] build_query({...}) — 0ms
```

A full trace (system prompts, LLM responses, tool results, timing) can be written to a file for debugging and analysis.

## Extending the harness

### New integrations

Adding a new external service = connecting to a new MCP server and building tools that call it. The agent infrastructure doesn't change. The LLM discovers new tools from the registry automatically.

### New capabilities

A single-tool capability: build the tool, register it. The LLM can use it immediately.

A multi-step workflow: build the tools, write a skill file with the recipe, add the skill name to the orchestrator's index.

### Other runtimes

The harness is not coupled to the agent loop. The same tools can be driven by:

- **Deterministic pipelines** — fixed step sequences with no LLM deciding. Useful when the workflow is fully known and the LLM adds no value to orchestration.
- **DAG workflows** — dependency-ordered steps with evaluation and retry at each node. Steps declare what they depend on; the executor handles ordering and concurrency.
- **Hybrid** — a deterministic pipeline that delegates one fuzzy step to an LLM (e.g. a fixed data pipeline that hands off to an agent for narrative generation).
- **Scripts** — direct tool calls for testing or one-off automation.

The key insight: tools don't know which runtime called them. This is what makes the harness composable.

### Evaluation and self-correction

An area for future development. Some tools would benefit from evaluating their own output — did the narrative cover all issues? Do the counts reconcile? Two patterns are relevant:

- **Deterministic eval** — assertions on counts, field presence, reconciliation. Cheap, reliable.
- **LLM-judged eval** — pass output + criteria to an LLM for quality assessment. More expensive, useful for prose quality.

The execution context already supports this — a tool has access to an LLM instance and prior results. The pattern is: execute, evaluate, decide (proceed / retry with different strategy / escalate). This could be formalized as the tools mature.

### Event-driven triggers

Currently the harness is invoked manually via CLI. The architecture is runtime-agnostic, so event-driven activation (webhooks, scheduled runs, message queue consumers) is a runner concern, not an architecture change. The harness doesn't care how it was started.

## Example: a multi-step report

A user asks "what's the team's progress this sprint." The agent loads a reporting skill and follows it:

```
Turn 1: load_skill            → step-by-step recipe
Turn 2: resolve_users         → "Resolved 8 team members"
Turn 3: build_query           → "Query built for 2 projects, 8 people"
Turn 4: search_issues         → "Found 27 items across 6 workstreams"
Turn 5: check_cache (diff)    → "3 added, 1 status change since last run"
Turn 6: check_cache (save)    → "Cached 27 items"
Turn 7: group_results         → "Grouped into 6 workstreams × 3 statuses"
Turn 8: generate_report       → formatted narrative document
Turn 9: LLM responds          → done
```

The skill controlled step order (diff before save, abort on no changes). The LLM made intent decisions (who to include, whether to continue after seeing the diff). The tools handled mechanics (query construction, API calls, caching, deterministic document assembly). The report tool made its own internal LLM call for prose generation — the orchestrator LLM never saw the raw data.
