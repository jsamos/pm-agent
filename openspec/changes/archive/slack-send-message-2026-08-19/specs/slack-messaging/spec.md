# Delta for Slack Messaging

## Purpose

Send and receive messages through Slack via the harness tool layer. The agent interacts with Slack through purpose-built harness tools that encapsulate the underlying MCP connection and enforce capability boundaries.

## ADDED Requirements

### Requirement: User Lookup

The system SHALL resolve a person's name to a Slack user ID via a harness tool.

#### Scenario: Lookup by name
- GIVEN a person's name "Alice"
- WHEN search_slack_users is called with query "Alice"
- THEN a list of matching Slack users is returned, each with userId and displayName

#### Scenario: No results
- GIVEN a name that matches no Slack users
- WHEN search_slack_users is called
- THEN an empty result set is returned with a summary indicating no matches

### Requirement: Send Message

The system SHALL send a message to a Slack channel or user via a harness tool.

#### Scenario: Direct message by user ID
- GIVEN a valid Slack user ID and a message body
- WHEN send_slack_message is called with the user ID as channelId
- THEN the message is delivered as a DM and a message link is returned

#### Scenario: Post to channel
- GIVEN a valid Slack channel ID and a message body
- WHEN send_slack_message is called with the channel ID
- THEN the message is posted to the channel and a message link is returned

#### Scenario: Thread reply
- GIVEN a valid channel ID, a message body, and a parent message timestamp
- WHEN send_slack_message is called with threadTs set
- THEN the message is posted as a reply in that thread

### Requirement: MCP Encapsulation

The agent SHALL NOT have direct access to Slack MCP tools. All Slack interactions MUST go through harness tools that wrap MCP calls internally.

#### Scenario: Agent tool surface
- GIVEN the agent's tool registry
- WHEN the agent lists available tools
- THEN only harness tools appear — no raw MCP tool names are visible to the agent

### Requirement: Connection Isolation

Slack MCP connections SHALL be lazy and managed internally by the tool layer. The agent loop and execution context SHALL NOT hold Slack connection handles.

#### Scenario: First call connects
- GIVEN no prior Slack MCP connection
- WHEN a Slack harness tool is called for the first time
- THEN a connection is established on demand and reused for subsequent calls
