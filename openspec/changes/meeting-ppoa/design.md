# Meeting PPOA — Design

Depends on: Notion MCP (`notion-fetch` with `include_transcript: true`), `meeting-ppoa` skill, dedicated PPOA LLM call.

## Flow

```
User: "PPOA for https://notion.so/…"
  → load_skill(meeting-ppoa)
  → fetch_notion_transcript(pageUrl)    — transcript stays in toolCallLog, summary sent to orchestrator
  → generate_meeting_ppoa({})           — dedicated LLM call, reads transcript from toolCallLog
  → agent-loop short-circuits           — finalOutput: true skips orchestrator's final turn
  → agent.ts outputs ppoa from toolCallLog directly to stdout
```

The orchestrator never sees the transcript text or the PPOA content. It only sees summary strings. The `agent.ts` script pulls the `ppoa` field from `toolCallLog` for direct output — same pattern as `generate_epic_narrative` and `generate_sprint_narrative`.

CLI verification:

```
npm run fetch-transcript -- <notion-page-url>
```

## Notion MCP response format

The `notion-fetch` MCP tool returns meeting note pages in enhanced-markdown XML. The raw transcript is only included when `include_transcript: true` is passed — otherwise a placeholder appears.

```xml
<meeting-notes attendees="user://...">
  Meeting Title
  <summary>
    ### Action Items
    - [ ] …
    ### Per-Person Updates
    - …
  </summary>
  <notes>
    …
  </notes>
  <transcript>
    Raw spoken text…
  </transcript>
</meeting-notes>
```

Key points:
- `<transcript>` contains the raw spoken text — this is the PPOA input
- `<summary>` is Notion's AI-generated summary (not used for PPOA)
- Without `include_transcript: true`, `<transcript>` contains `"Transcript omitted…"`
- The outer response also includes `<page>` wrapper with metadata, properties, etc.

## Helper: `extractTranscriptText`

Location: `src/lib/notion-transcript.ts`

Input: full text response from `notion-fetch` (the `.text` field from the MCP result).

Algorithm:
1. Extract content between `<transcript>` and `</transcript>` tags
2. Strip leading/trailing whitespace and tab indentation from each line
3. Return `null` if no `<transcript>` tag found or content is the "Transcript omitted" placeholder

Also extract:
- **Title**: text between `<meeting-notes …>` and `<summary>` (first non-empty line after the tag)
- **Page URL**: from the `<page url="…">` attribute

## Tool: `fetch_notion_transcript`

Location: `src/tools/notion/fetch-transcript.ts`

- Calls `notion-fetch` via shared `callNotionTool` with `{ id: pageUrl, include_transcript: true }`
- Applies `extractTranscriptText` to parse the `<transcript>` block
- Falls back to full page text (stripped of XML tags) for non-meeting-note pages
- Returns `{ title, transcript, pageId, url, charCount, summary }`
- The `summary` field triggers the agent-loop summary pattern — only the summary string reaches the orchestrator; the full transcript stays in `toolCallLog` for `generate_meeting_ppoa` to read

## Tool: `generate_meeting_ppoa`

Location: `src/tools/meeting/generate-meeting-ppoa.ts`

- Reads transcript from `toolCallLog` (prior `fetch_notion_transcript` result) or accepts a direct `transcript` parameter
- Makes a dedicated `context.llm.generate()` call with `src/prompts/meeting-ppoa.md` as the system prompt and the raw transcript as the user message
- Uses `getToolLlmConfig("generate_meeting_ppoa")` for model/temperature/maxTokens
- Returns `{ ppoa, title, charCount, summary, finalOutput: true }`
- `finalOutput: true` triggers the agent-loop short-circuit — the orchestrator does not get a final turn after this tool completes

## Prompt: `meeting-ppoa.md`

Location: `src/prompts/meeting-ppoa.md`

Focused system prompt for the PPOA LLM call. Defines the four sections (Product Requirements, Project Management, Open Questions, Action Items), formatting rules, and constraints. No orchestrator context or competing instructions.

## Output pipeline

`src/scripts/agent.ts` checks `toolCallLog` for a `generate_meeting_ppoa` result before checking for narrative results. When found, outputs `result.ppoa` directly to stdout, bypassing the orchestrator's chat response entirely. Same pattern as epic/sprint narratives.

Register both tools in `src/agent/registry.ts`.

## Script

`src/scripts/fetch-notion-transcript.ts` — calls tool execute, prints transcript to stdout, logs title/char count to stderr.

`package.json`: `"fetch-transcript": "tsx src/scripts/fetch-notion-transcript.ts"`

## Files

| File | Change |
|------|--------|
| `src/lib/notion-transcript.ts` | `extractTranscriptText`, `extractMeetingTitle`, `extractPageUrl` |
| `src/lib/notion-transcript.test.ts` | Extraction scenarios |
| `src/tools/notion/fetch-transcript.ts` | `fetch_notion_transcript` tool |
| `src/tools/notion/index.ts` | Export |
| `src/tools/meeting/generate-meeting-ppoa.ts` | `generate_meeting_ppoa` tool (dedicated LLM call) |
| `src/tools/meeting/generate-meeting-ppoa.test.ts` | 4 test scenarios |
| `src/prompts/meeting-ppoa.md` | PPOA system prompt |
| `src/skills/meeting-ppoa.md` | Skill with numbered workflow steps + frontmatter |
| `src/skills/meeting-ppoa.test.ts` | Skill structure tests |
| `src/tools/skills/load-skill.ts` | Refactored to parse YAML frontmatter (single skill registry) |
| `src/prompts/orchestrator.md` | Removed manual skill index (load_skill is sole source) |
| `src/lib/agent-loop.ts` | `finalOutput` short-circuit |
| `src/lib/agent-loop.test.ts` | Short-circuit test |
| `src/scripts/agent.ts` | PPOA output bypass from toolCallLog |
| `src/agent/registry.ts` | Register both tools |
| `src/agent/registry.test.ts` | Assert registered |
| `src/scripts/fetch-notion-transcript.ts` | Live fetch CLI |
| `package.json` | `fetch-transcript` script |
| `openspec/specs/meeting-ppoa/spec.md` | Canonical spec |

## Documentation

### README.md

- Add `generate_meeting_ppoa` to the tools table
- Add `fetch_notion_transcript` to the tools table
- Add `meeting-ppoa` to the behavioral specs table
- Document the `finalOutput` short-circuit pattern in agent loop section

### Spec scenario tags

Both spec copies are kept in sync:

- [`openspec/specs/meeting-ppoa/spec.md`](../../specs/meeting-ppoa/spec.md)
- [`openspec/changes/meeting-ppoa/specs/meeting-ppoa/spec.md`](specs/meeting-ppoa/spec.md)

### Scenario → test mapping

| Spec scenario | Test title | File |
|---------------|------------|------|
| Fetch transcript by URL | `returns transcript with include_transcript passed to MCP` | [`src/tools/notion/notion.test.ts`](../../../src/tools/notion/notion.test.ts) |
| Fetch transcript by URL | `extracts and dedents transcript from meeting-notes XML` | [`src/lib/notion-transcript.test.ts`](../../../src/lib/notion-transcript.test.ts) |
| Fetch transcript by page ID | `accepts a raw page ID` | [`src/tools/notion/notion.test.ts`](../../../src/tools/notion/notion.test.ts) |
| Invalid page | `raises when the MCP call fails` | [`src/tools/notion/notion.test.ts`](../../../src/tools/notion/notion.test.ts) |
| Invalid page | `raises when no transcript block is present` | [`src/tools/notion/notion.test.ts`](../../../src/tools/notion/notion.test.ts) |
| Script prints transcript | `[manual]` live run | [`src/scripts/fetch-notion-transcript.ts`](../../../src/scripts/fetch-notion-transcript.ts) |
| Script missing URL | `[manual]` | — |
| Notion URL triggers fetch | `first step instructs calling fetch_notion_transcript for a Notion URL` | [`src/skills/meeting-ppoa.test.ts`](../../../src/skills/meeting-ppoa.test.ts) |
| Inline transcript skips fetch | `second step uses pasted or uploaded transcript directly without fetch` | [`src/skills/meeting-ppoa.test.ts`](../../../src/skills/meeting-ppoa.test.ts) |
| Orchestrator skill index | `appears in load_skill available skills with a description` | [`src/skills/meeting-ppoa.test.ts`](../../../src/skills/meeting-ppoa.test.ts) |
| Roster names injected into PPOA prompt | `includes roster names in the system prompt` | [`src/tools/meeting/generate-meeting-ppoa.test.ts`](../../../src/tools/meeting/generate-meeting-ppoa.test.ts) |
| Dedicated LLM generates PPOA | `reads transcript from prior fetch_notion_transcript result` | [`src/tools/meeting/generate-meeting-ppoa.test.ts`](../../../src/tools/meeting/generate-meeting-ppoa.test.ts) |
| Dedicated LLM generates PPOA | `accepts transcript directly as a parameter` | [`src/tools/meeting/generate-meeting-ppoa.test.ts`](../../../src/tools/meeting/generate-meeting-ppoa.test.ts) |
| No transcript available | `throws when no transcript is available` | [`src/tools/meeting/generate-meeting-ppoa.test.ts`](../../../src/tools/meeting/generate-meeting-ppoa.test.ts) |
| Empty LLM response | `returns failure summary when LLM returns empty` | [`src/tools/meeting/generate-meeting-ppoa.test.ts`](../../../src/tools/meeting/generate-meeting-ppoa.test.ts) |
| finalOutput short-circuit | `short-circuits when tool returns finalOutput: true` | [`src/lib/agent-loop.test.ts`](../../../src/lib/agent-loop.test.ts) |
