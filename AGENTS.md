# Agent Instructions

## New Features

Before building a new feature or integration, write specs first in `openspec/`:

1. **Proposal** (`openspec/changes/<name>/proposal.md`) — Intent, scope, and out-of-scope boundaries.
2. **Behavioral spec** (`openspec/specs/<name>/spec.md`) — Requirements and scenarios using RFC 2119 keywords (SHALL, MUST, MAY).
3. **Design** (`openspec/changes/<name>/design.md`) — Architecture, tools to create, files to modify, auth, documentation, and tests. **Must include a `## Documentation` section** (see below).

Also copy the behavioral spec into `openspec/changes/<name>/specs/<name>/spec.md` so the change folder is a self-contained packet (proposal + design + spec). **While the change is in progress, keep both spec files identical** — edit the canonical file first, then mirror to the change copy.

| Path | Purpose |
|------|---------|
| `openspec/specs/<name>/spec.md` | **Canonical** — long-lived source of truth for implemented behavior |
| `openspec/changes/<name>/specs/<name>/spec.md` | **Change copy** — same content, bundled with proposal and design |

When the feature ships, move `openspec/changes/<name>/` to `openspec/changes/archive/`. The canonical spec stays in `openspec/specs/`. Later amendments update only the canonical spec unless a new change folder is opened.

Scenario tags:

| Tag | When to use |
|-----|-------------|
| `[tested]` | An automated test **directly asserts the scenario's WHEN/THEN** — not merely related code in the same file or feature area. |
| `[manual]` | True end-to-end behavior that cannot run in CI (e.g. live Jira + Notion with real credentials). |
| *(untagged)* | Planned or partially implemented; not yet verified. |

**`[tested]` requirements:**

1. **Name the scenario in the test** — use a comment (`// Scenario: …`) or a `describe`/`it` title that matches the spec scenario heading so reviewers can trace spec ↔ test.
2. **Exercise the WHEN** — call the tool, parser, or assembly function the scenario describes. Scenarios about **skill or prompt instructions** MAY assert on the skill/prompt artifact via a parser test when the THEN is what the orchestrator is told to do (not what it did in a live run).
3. **Assert the THEN** — check outputs, thrown errors, side effects, or call order exactly as the spec states.
4. **One scenario, one primary test** — a single test may cover multiple assertions for the same scenario; do not mark a scenario `[tested]` because a nearby scenario in the same module is tested.

**Do not mark `[tested]` when:**

- Coverage is only indirect (e.g. "happy path runs" but the scenario is about a specific edge case).
- The test only reads static skill/prompt markdown **without a parser or structured assertion** (a bare `toContain` on one phrase is not enough).
- The spec and implementation diverge (fix the spec or the code first, then tag).

When adding `[tested]`, add or update the test in the same change. When removing behavior, remove the tag or delete the scenario.

Each change **`design.md` MUST include a `## Documentation` section** with:

1. **`README.md`** — bullet list of what to add or update for this feature (sections, tools table, behavioral specs table, examples). Do not duplicate full README prose in the design; list the targets.
2. **Spec scenario tags** — links to both spec copies for this change, plus a **scenario → test mapping** table (scenario name, `it('…')` title to fill at ship time, test file link). See `openspec/changes/sprint-qa-queue/design.md` or `openspec/changes/archive/2026-09-03-roster-work-pages/design.md` for the pattern.

When implementation and tests land, follow the tag rules below **and** complete the Documentation checklist in that change's `design.md` (README updates, tag both spec copies, fill in the mapping table).

**Spec tagging rules** (apply when shipping; paths for each change live in its `design.md`):

| Path | Purpose |
|------|---------|
| `openspec/specs/<name>/spec.md` | Canonical — add tags and test links here first |
| `openspec/changes/<name>/specs/<name>/spec.md` | Change copy — keep identical while the change is in progress |

For each `[tested]` scenario, add a **Test** line with the exact `it(...)` title (or `describe` title when the whole block maps to one scenario) and a markdown link to the test file:

```markdown
#### Scenario: Example behavior [tested]

- GIVEN …
- WHEN …
- THEN …
- **Test:** `does the thing described in the scenario` — [`src/path/module.test.ts`](../../../src/path/module.test.ts)
```

Use paths relative to the spec file so links resolve from `openspec/specs/<name>/` (typically `../../../src/…`) or `openspec/changes/<name>/specs/<name>/` (typically `../../../../src/…`).

Do not mark a scenario `[tested]` until the linked test exists and asserts the THEN. Use `[manual]` only when CI coverage is genuinely impossible — not as a shortcut for skipped tests.

Commit the specs before writing any implementation code. See `openspec/changes/archive/2026-08-25-smart-update/` or `openspec/changes/epic-notion-cascade/` for examples.

## Tests

Run the full test suite before committing any change to `src/`:

```bash
npm test
```

This runs `vitest run` across all `*.test.ts` files. All tests must pass.

If you modify any tool in `src/tools/` or any assembly/rendering logic, check that the corresponding test file exists and covers the change.

**Rule of thumb:** if the change affects what the user sees — new output, different format, new behavior — add or update tests. Mock LLM responses and external services when testing tool `execute` flows; don't skip tests just because the code path involves an LLM call. See `generate-epic-narrative.test.ts` for the pattern: build a `toolCallLog` with realistic fixtures, mock `context.llm.generate` to return a canned JSON string, and assert on the final output.

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
