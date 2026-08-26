# LLM TPM Rate Limiting

## Intent

Prevent OpenAI 429 TPM failures during sprint narrative generation (and other multi-call workflows) by pacing all LLM requests against a configurable tokens-per-minute budget. Proactive pacing replaces heuristic concurrency caps as the primary throttle; reactive retry remains a safety net.

Today, parallel inner narrative calls can burst past org TPM limits (e.g. 30k/min), causing tool failures, orchestrator retry loops, and wasted tokens. Rate limiting belongs at the **LLM provider layer** so orchestrator turns and inner tool calls share one budget.

## Scope

- Configurable TPM limit (`OPENAI_TPM_LIMIT` or equivalent in config)
- Process-wide rolling token bucket shared by all `llm.generate` / `generateWithTools` calls
- Post-call accounting from OpenAI `usage` (prompt + completion tokens)
- Pre-call token **reservation** via configurable estimate (`LLM_TOKEN_ESTIMATE`, default ~3000) so parallel callers don't overshoot before usage is known
- Pre-call **wait** when the rolling window would exceed budget
- Optional calibration from OpenAI rate-limit response headers on success
- Retain existing reactive 429 retry as fallback when estimates or headers are wrong
- Remove narrative-specific concurrency cap (`NARRATIVE_LLM_CONCURRENCY`) once the limiter is in place
- Tests for bucket pacing, usage recording, and integration with retry

## Out of scope

- Requests-per-minute (RPM) limiting — can add later with same wrapper
- Accurate pre-call token estimation via tiktoken (v1 uses a fixed configurable reserve; actual usage reconciled post-call)
- Cross-process or cross-agent coordination (single CLI process only)
- Non-OpenAI providers (structure should allow extension)
- Billing/quota tracking beyond in-process pacing
- Changing orchestrator max-turns or idempotency guards (separate workflow fixes; may simplify once 429s stop)
