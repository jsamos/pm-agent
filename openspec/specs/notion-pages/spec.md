# Notion Pages

## Purpose

Create and update Notion pages through the harness tool layer. The agent interacts with Notion through purpose-built harness tools that encapsulate the underlying MCP connection and enforce capability boundaries. All page content uses markdown format.

## Requirements

### Requirement: Fetch Page

The system SHALL retrieve the content of a Notion page by URL or ID and return it as markdown.

#### Scenario: Fetch by URL

- GIVEN a valid Notion page URL
- WHEN fetch_notion_page is called with the URL
- THEN the page title and markdown content are returned

#### Scenario: Fetch by page ID

- GIVEN a valid Notion page ID (UUID)
- WHEN fetch_notion_page is called with the ID
- THEN the page title and markdown content are returned

#### Scenario: Invalid page

- GIVEN a URL or ID that does not resolve to a Notion page
- WHEN fetch_notion_page is called
- THEN an error is raised indicating the page was not found

### Requirement: Create Page

The system SHALL create a new child page under a specified parent page.

#### Scenario: Create with markdown content

- GIVEN a parent page URL, a title, and markdown content
- WHEN create_notion_page is called
- THEN a new page is created under the parent with the given title and content
- AND the new page's URL is returned

#### Scenario: Create with content from prior tool

- GIVEN a parent page URL, a title, and a contentFrom reference to a prior tool
- WHEN create_notion_page is called
- THEN the full output of the referenced tool is used as the page content

#### Scenario: Missing parent

- GIVEN a parent URL that does not resolve to a valid page
- WHEN create_notion_page is called
- THEN an error is raised

### Requirement: Update Page

The system SHALL replace the content of an existing Notion page.

#### Scenario: Full content replace

- GIVEN a page URL and new markdown content
- WHEN update_notion_page is called
- THEN the page content is replaced with the new markdown
- AND the page title MAY be updated if a new title is provided

#### Scenario: Update with content from prior tool

- GIVEN a page URL and a contentFrom reference
- WHEN update_notion_page is called
- THEN the full output of the referenced tool replaces the page content

### Requirement: URL Parsing

The system SHALL extract Notion page IDs from standard Notion URLs.

#### Scenario: Standard URL

- GIVEN a URL like `https://www.notion.so/workspace/Page-Title-a1b2c3d4e5f67890abcdef1234567890`
- WHEN the URL is parsed
- THEN the 32-character hex page ID is extracted

#### Scenario: Notion Sites URL

- GIVEN a URL like `https://myspace.notion.site/Page-Title-abc123def456`
- WHEN the URL is parsed
- THEN the page ID is extracted

#### Scenario: Raw UUID passthrough

- GIVEN a raw UUID string (with or without dashes)
- WHEN it is passed as a page identifier
- THEN it is used directly without transformation

### Requirement: MCP Encapsulation

The agent SHALL NOT have direct access to Notion MCP tools. All Notion interactions MUST go through harness tools that wrap MCP calls internally.

#### Scenario: Agent tool surface

- GIVEN the agent's tool registry
- WHEN the agent lists available tools
- THEN only harness tools appear — no raw MCP tool names (e.g. notion-fetch, notion-create-pages, notion-update-page) are visible to the agent

### Requirement: Connection Isolation

Notion MCP connections SHALL be lazy and managed internally by the tool layer. The agent loop and execution context SHALL NOT hold Notion connection handles.

#### Scenario: First call connects

- GIVEN no prior Notion MCP connection
- WHEN a Notion harness tool is called for the first time
- THEN a connection is established on demand and reused for subsequent calls
