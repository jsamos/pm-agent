# Slack Send Message

## Intent

Add the ability to send Slack messages through the harness. A user should be able to say "send Alice a message on Slack" and the agent resolves the user, sends the message, and returns a link.

## Scope

- Slack user lookup (search by name)
- Send a message to a user (DM) or channel
- Thread replies

## Out of scope

- Reading messages or channels
- Reactions, canvases, or rich formatting
- Channel creation or management
- Guardrails (allowlists, draft-only mode) — deferred until needed
