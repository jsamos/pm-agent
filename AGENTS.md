# Agent Instructions

## Tests

Run the full test suite before committing any change to `src/`:

```bash
npm test
```

This runs `vitest run` across all `*.test.ts` files. All tests must pass.

If you modify any tool in `src/tools/` or any assembly/rendering logic, check that the corresponding test file exists and covers the change. Add tests for new pure functions — especially anything that transforms data or assembles output.

Do not commit if tests fail. Fix the failing tests first.

Never use real names of people or companies in tests, comments, or tool descriptions. Use generic placeholders (e.g. Alice Martin, Bob Chen, PROJ-100, example.atlassian.net). This repo is public.

## Project Structure

- `src/skills/` — Orchestrator workflow skills (multi-step recipes loaded on demand via `load_skill`)
- `src/prompts/` — LLM system prompts for single-task agents (e.g. narrative writing instructions)
- `src/tools/jira/` — Jira tools (each tool is a single file with an exported `Tool` object)
- `src/tools/skills/` — The `load_skill` tool that reads skill files at runtime
- `src/agent/` — Agent orchestration (system prompt assembly, registry)
- `src/lib/` — Shared infrastructure (agent loop, cache, LLM providers, models)
- `src/config/` — Runtime configuration (`jira.json` is gitignored, `jira.example.json` is committed)
- `src/scripts/` — CLI entry points
- `output/cache/` — Snapshot cache (ndjson, gitignored)
- `output/traces/` — Agent trace logs when `AGENT_TRACE=1` (gitignored)

## Key Conventions

- **Skills vs Prompts**: Skills (`src/skills/`) are multi-step workflow recipes the orchestrator loads on demand. Prompts (`src/prompts/`) are static system prompts for single-task LLM calls. Don't mix them.
- The orchestrator prompt (`src/prompts/orchestrator.md`) contains only response rules and a skill index — workflow details live in skill files.
- The tool registry auto-generates the orchestrator's tool catalog — do not hand-maintain a tool list in the prompt.
- Assembly functions (e.g. `assembleMarkdown`, `assembleEpicMarkdown`) are exported and tested independently of LLM calls.

## Tracing

The agent loop always logs LLM and tool timing to stderr. For full traces (prompts, responses, tool results):

```bash
AGENT_TRACE=1 npm run agent -- "your prompt" > output/result.md
```

Trace files are written to `output/traces/<timestamp>.ndjson`.
