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

### Requirement: Skill Registration

The orchestrator SHALL list meeting-ppoa among available multi-step skills.

#### Scenario: Orchestrator skill index [tested]

- GIVEN the load_skill tool description
- WHEN the agent starts a session
- THEN meeting-ppoa appears in the available skills list with a description
- **Test:** `appears in load_skill available skills with a description` — [`src/skills/meeting-ppoa.test.ts`](../../../../src/skills/meeting-ppoa.test.ts)
