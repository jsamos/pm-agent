# Meeting PPOA — Design (transcript fetch foundation)

Depends on: Notion MCP (`notion-fetch` with `include_transcript: true`), `meeting-ppoa` skill.

## Flow

```
User: "PPOA for https://notion.so/…"
  → load_skill(meeting-ppoa)
  → fetch_notion_transcript(pageUrl)
  → (agent summarizes in chat using skill format — no new tool yet)
```

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

Register in `src/agent/registry.ts`.

## Script

`src/scripts/fetch-notion-transcript.ts` — calls tool execute, prints transcript to stdout, logs title/char count to stderr.

`package.json`: `"fetch-transcript": "tsx src/scripts/fetch-notion-transcript.ts"`

## Files (this change — tool + script only)

| File | Change |
|------|--------|
| `src/lib/notion-transcript.ts` | `extractTranscriptText`, `extractMeetingTitle`, `extractPageUrl` |
| `src/lib/notion-transcript.test.ts` | Extraction scenarios |
| `src/tools/notion/fetch-transcript.ts` | New tool |
| `src/tools/notion/index.ts` | Export |
| `src/agent/registry.ts` | Register tool |
| `src/agent/registry.test.ts` | Assert registered |
| `src/scripts/fetch-notion-transcript.ts` | Live fetch CLI |
| `package.json` | `fetch-transcript` script |
| `openspec/specs/meeting-ppoa/spec.md` | Canonical spec |

**Not in this change** (deferred to follow-up):
- `src/skills/meeting-ppoa.md` — numbered fetch step
- `src/skills/meeting-ppoa.test.ts` — skill workflow test
- `src/prompts/orchestrator.md` — skill index entry
- README updates

## Documentation

### README.md

(Deferred to follow-up when skill wiring lands)

### Spec scenario tags

When implementation and tests land, update both spec copies:

- [`openspec/specs/meeting-ppoa/spec.md`](../../specs/meeting-ppoa/spec.md)
- [`openspec/changes/meeting-ppoa/specs/meeting-ppoa/spec.md`](specs/meeting-ppoa/spec.md)

### Scenario → test mapping (fill in at ship time)

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
