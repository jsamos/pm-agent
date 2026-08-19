# Multi-Service MCP Support

## Intent

Refactor the connection layer and CLI scripts to support multiple MCP services. Currently everything is hardcoded to Atlassian. Adding Slack (and future services) requires the connection and scripts to be service-aware.

## Scope

- Refactor `connection.ts` to a named service registry with hardcoded MCP URLs
- Update `jira/client.ts` to use `connect("jira")`
- Refactor `auth.ts`, `check.ts`, and `list-tools.ts` to accept a service argument
- No new npm scripts — existing commands gain a service parameter

## Out of scope

- Slack tools (separate change)
- Config-driven MCP URLs (URLs are not sensitive, keep them hardcoded)
