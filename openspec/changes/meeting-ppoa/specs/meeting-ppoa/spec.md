# Meeting PPOA

## Purpose

Summarize meeting transcripts into Product Requirements, Project Management, Open Questions, and Action Items. Transcripts are most often fetched from Notion, but MAY also be pasted directly, uploaded as a file, or sourced from other services (Zoom, Granola, Otter, etc.).

## Requirements

### Requirement: Fetch Notion Transcript

The system SHALL provide a tool that downloads a Notion page and returns transcript-ready text.

#### Scenario: Fetch transcript by URL [tested]

- GIVEN a valid Notion page URL containing a meeting transcript
- WHEN `fetch_notion_transcript` is called with that URL
- THEN the page title, transcript body, page ID, and canonical URL are returned
- AND the transcript body excludes Notion fetch metadata lines (Page ID, URL) and the title heading
- **Test:** `returns transcript with include_transcript passed to MCP` — [`src/tools/notion/notion.test.ts`](../../../../src/tools/notion/notion.test.ts)
- **Test:** `extracts and dedents transcript from meeting-notes XML` — [`src/lib/notion-transcript.test.ts`](../../../../src/lib/notion-transcript.test.ts)

#### Scenario: Fetch transcript by page ID [tested]

- GIVEN a valid Notion page ID
- WHEN `fetch_notion_transcript` is called with the ID
- THEN the same fields are returned as for a URL
- **Test:** `accepts a raw page ID` — [`src/tools/notion/notion.test.ts`](../../../../src/tools/notion/notion.test.ts)

#### Scenario: Invalid page [tested]

- GIVEN a URL or ID that does not resolve
- WHEN `fetch_notion_transcript` is called
- THEN an error is raised
- **Test:** `raises when the MCP call fails` — [`src/tools/notion/notion.test.ts`](../../../../src/tools/notion/notion.test.ts)
- **Test:** `raises when no transcript block is present` — [`src/tools/notion/notion.test.ts`](../../../../src/tools/notion/notion.test.ts)

### Requirement: Transcript Fetch Script

The system SHALL provide a CLI script to verify live Notion transcript fetch.

#### Scenario: Script prints transcript [manual]

- GIVEN a Notion page URL passed as a command-line argument
- WHEN the fetch-transcript script runs with valid Notion credentials
- THEN the transcript text is written to stdout
- AND the process exits with code 0

#### Scenario: Script missing URL [manual]

- GIVEN no page URL argument
- WHEN the fetch-transcript script runs
- THEN usage instructions are printed
- AND the process exits with code 1

### Requirement: Meeting PPOA Skill Orchestration

The meeting-ppoa skill SHALL contain numbered steps that the agent follows in order, with `fetch_notion_transcript` as the first step when a Notion URL is present.

#### Scenario: Notion URL triggers fetch [tested]

- GIVEN the meeting-ppoa skill text
- WHEN the numbered steps are parsed
- THEN the first step instructs calling `fetch_notion_transcript` when the user provides a Notion page URL
- **Test:** `first step instructs calling fetch_notion_transcript for a Notion URL` — [`src/skills/meeting-ppoa.test.ts`](../../../../src/skills/meeting-ppoa.test.ts)

#### Scenario: Inline or uploaded transcript skips fetch [tested]

- GIVEN the meeting-ppoa skill text
- WHEN the numbered steps are parsed
- THEN there is a branch for pasted or uploaded transcript text that does not require a Notion fetch
- AND the agent uses the provided text as the transcript source
- **Test:** `second step uses pasted or uploaded transcript directly without fetch` — [`src/skills/meeting-ppoa.test.ts`](../../../../src/skills/meeting-ppoa.test.ts)

### Requirement: Dedicated PPOA Generation

The system SHALL use a dedicated LLM call (not the orchestrator) to produce the PPOA from the transcript.

#### Scenario: Dedicated LLM generates PPOA [tested]

- GIVEN a transcript available in `toolCallLog` from a prior `fetch_notion_transcript` call
- WHEN `generate_meeting_ppoa` is called
- THEN a focused LLM call is made with the PPOA system prompt and the raw transcript
- AND the result contains the four-section PPOA markdown with a title heading
- **Test:** `reads transcript from prior fetch_notion_transcript result` — [`src/tools/meeting/generate-meeting-ppoa.test.ts`](../../../../src/tools/meeting/generate-meeting-ppoa.test.ts)
- **Test:** `accepts transcript directly as a parameter` — [`src/tools/meeting/generate-meeting-ppoa.test.ts`](../../../../src/tools/meeting/generate-meeting-ppoa.test.ts)

#### Scenario: Roster names injected into PPOA prompt [tested]

- GIVEN a team roster exists on disk with display names
- WHEN `generate_meeting_ppoa` is called
- THEN the system prompt includes the roster display names with an instruction to normalize spoken names
- **Test:** `includes roster names in the system prompt` — [`src/tools/meeting/generate-meeting-ppoa.test.ts`](../../../../src/tools/meeting/generate-meeting-ppoa.test.ts)

#### Scenario: No transcript available [tested]

- GIVEN no prior `fetch_notion_transcript` result and no `transcript` parameter
- WHEN `generate_meeting_ppoa` is called
- THEN an error is raised
- **Test:** `throws when no transcript is available` — [`src/tools/meeting/generate-meeting-ppoa.test.ts`](../../../../src/tools/meeting/generate-meeting-ppoa.test.ts)

#### Scenario: Empty LLM response [tested]

- GIVEN a transcript is available
- WHEN the dedicated LLM returns empty content
- THEN the tool returns a failure summary without crashing
- **Test:** `returns failure summary when LLM returns empty` — [`src/tools/meeting/generate-meeting-ppoa.test.ts`](../../../../src/tools/meeting/generate-meeting-ppoa.test.ts)

### Requirement: Final Output Short-Circuit

When a tool returns `finalOutput: true`, the agent loop SHALL skip the orchestrator's final LLM turn and return immediately. The PPOA tool, epic narrative, and sprint narrative all set this flag.

#### Scenario: finalOutput short-circuit [tested]

- GIVEN a tool that returns `{ ..., finalOutput: true }`
- WHEN the agent loop receives the tool result
- THEN it returns immediately without making another LLM call
- AND the result's `summary` is used as the loop response
- **Test:** `short-circuits when tool returns finalOutput: true` — [`src/lib/agent-loop.test.ts`](../../../../src/lib/agent-loop.test.ts)

### Requirement: Skill Registration

The orchestrator SHALL list meeting-ppoa among available multi-step skills.

#### Scenario: Orchestrator skill index [tested]

- GIVEN the load_skill tool description
- WHEN the agent starts a session
- THEN meeting-ppoa appears in the available skills list with a description
- **Test:** `appears in load_skill available skills with a description` — [`src/skills/meeting-ppoa.test.ts`](../../../../src/skills/meeting-ppoa.test.ts)
