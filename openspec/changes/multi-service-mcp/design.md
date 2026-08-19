# Multi-Service MCP Support

## Connection layer

### Refactor `src/lib/connection.ts`

Currently hardcodes the Atlassian MCP URL as `DEFAULT_CONFIG`. Refactor to a service registry with hardcoded URLs per service. MCP endpoints are not sensitive and should not be in config — they are implementation details encapsulated inside the connection layer.

```typescript
const SERVICES: Record<string, ConnectionConfig> = {
  jira: { serverUrl: "https://mcp.atlassian.com/v1/mcp/authv2", name: "atlassian" },
  slack: { serverUrl: "https://mcp.slack.com/mcp", name: "slack" },
};

export function connect(service: string): Promise<Client>
export function listServices(): string[]
```

Keep backward compatibility during transition by defaulting to `"jira"` if no service is specified.

### `src/tools/jira/client.ts`

Update to call `connect("jira")` instead of `connect()` with default config.

## Scripts

Refactor `auth.ts`, `check.ts`, and `list-tools.ts` to accept a service argument. One script, one concept — scales without npm script sprawl.

```
npm run auth -- jira       # OAuth flow for Jira
npm run auth -- slack      # OAuth flow for Slack
npm run auth:force -- jira # Clear tokens + re-auth
npm run check -- jira      # Verify Jira connection
npm run check -- slack     # Verify Slack connection
npm run tools -- slack     # List Slack MCP tools
```

No argument lists available services. The scripts use `connect(service)` from the refactored connection module.

No new npm scripts needed — existing `auth`, `auth:force`, `check`, `tools`, `tools:verbose` just gain a service argument.

## Tests

- Update any existing tests that call `connect()` without a service argument
- No new test files needed — this is a refactor of existing infrastructure
