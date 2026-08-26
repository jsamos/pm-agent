# LLM TPM Rate Limiting — Design

## Problem

```
orchestrator LLM ──┐
                   ├──> OpenAI API (shared org TPM, e.g. 30k/min)
narrative × 13 ────┘     burst → 429 → tool error → orchestrator retries → 3× token burn
```

Reactive retry (SDK + `withRateLimitRetry`) handles individual 429s but not **parallel bursts**: many calls start before any 429 returns, so several fail and the whole `Promise.all` aborts.

A fixed concurrency cap (e.g. 3) is a heuristic band-aid: too aggressive on high TPM tiers, still wrong on low tiers with large prompts.

## Target architecture

```
Agent loop / generate_sprint_narrative
        │
        ▼
   LLM interface (generate / generateWithTools)
        │
        ▼
   RateLimitedLLM wrapper  ◄── OPENAI_TPM_LIMIT
        │    • acquire before call (wait if needed)
        │    • record usage after call
        ▼
   OpenAILLM (SDK maxRetries + withRateLimitRetry as fallback)
        │
        ▼
   OpenAI API
```

All LLM traffic in one process goes through the wrapper. Narrative generation fires as many logical tasks as needed; the limiter **paces** them, not a hardcoded concurrency constant.

## New file: `src/lib/token-bucket.ts`

Rolling 60-second window token bucket.

```typescript
interface TokenBucketOptions {
  limit: number;           // TPM ceiling (tokens per 60s window)
  windowMs?: number;       // default 60_000
}

interface TokenBucket {
  /** Wait until `tokens` can be charged, then reserve them. */
  acquire(tokens: number): Promise<void>;
  /** Record actual usage after a call (adjusts reservation vs actual). */
  record(actualTokens: number, reservedTokens: number): void;
  /** Optional: sync remaining budget from provider headers. */
  syncFromHeaders(remaining: number | null, resetMs: number | null): void;
}
```

### Window semantics

- Track `{ timestamp, tokens }` entries in a rolling window (sliding sum, not fixed clock buckets).
- On `acquire(n)`: sum tokens in last 60s; if `sum + n > limit`, sleep until oldest entries expire enough headroom, then add reservation.
- On `record(actual, reserved)`: replace reservation with actual in the log (or adjust delta).

### Pre-call estimate (v1)

Before the call, reserve a **conservative estimate** so parallel callers don't all pass acquire simultaneously:

- Default estimate: env `LLM_TOKEN_ESTIMATE` (default 3000)
- After response: charge actual `usage.prompt_tokens + usage.completion_tokens`, refund `(reserved - actual)` if reserved was higher

This avoids tiktoken dependency in v1. Estimates can be tuned per tool later.

### Header sync (optional enhancement in v1)

OpenAI success responses include:

- `x-ratelimit-remaining-tokens`
- `x-ratelimit-reset-tokens` (e.g. `6s`)

If present, adjust internal bucket state so local tracking stays aligned with the provider. Headers are authoritative when available; local accounting is fallback.

## New file: `src/lib/rate-limited-llm.ts`

Wraps any `LLM` implementation:

```typescript
function createRateLimitedLLM(inner: LLM, bucket: TokenBucket, estimate: number): LLM
```

Both `generate` and `generateWithTools` call `bucket.acquire(estimate)` before delegating, then `bucket.record(actual, estimate)` after.

Logging (stderr):

```
[llm] TPM wait — 4.2s (28k/30k used, reserving ~3000)
```

## Changes to `src/lib/providers/openai.ts`

1. Parse and expose `usage` from completion responses (extend `LLMResponse` or return side-channel — see below).
2. Capture rate-limit headers from the raw response (may require `.withResponse()` or reading from SDK error/success objects).
3. Factory in `openaiProvider.create()` wraps `OpenAILLM` with `createRateLimitedLLM` when `OPENAI_TPM_LIMIT` is set.

### `LLMResponse` extension

Add optional usage to the provider-agnostic response:

```typescript
interface LLMResponse {
  // ...existing
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}
```

Only OpenAI populates this initially; bucket uses `totalTokens` when present, else falls back to estimate.

## Configuration

| Env / config | Default | Purpose |
|--------------|---------|---------|
| `OPENAI_TPM_LIMIT` | unset | When set, enable rate-limited wrapper. When unset, pass-through (current behavior). |
| `LLM_TOKEN_ESTIMATE` | `3000` | Pre-call reservation per request |
| `LLM_MAX_RETRIES` | `5` | Existing reactive retry cap (unchanged) |

Document in README: tier-1 accounts should set `OPENAI_TPM_LIMIT=30000` (or their org limit).

## Changes to `src/tools/jira/generate-sprint-narrative.ts`

- **Remove** `NARRATIVE_LLM_CONCURRENCY` and `mapWithConcurrency` for TPM purposes.
- **Keep** `withRateLimitRetry` on inner calls OR rely solely on provider-level retry (prefer single retry layer at provider — avoid double retry; design choice: retry only in `OpenAILLM`, remove inner `withRateLimitRetry` when limiter lands).
- Inner calls become sequential-from-limiter perspective but may still run concurrently up to however many pass `acquire` — natural pacing without a magic concurrency number.

Optional: retain `mapWithConcurrency` only as `LLM_MAX_IN_FLIGHT` (default unlimited) if we want to cap simultaneous HTTP connections separately from TPM — out of scope for v1 unless needed.

## Interaction with existing reactive retry

| Layer | Role |
|-------|------|
| Token bucket | **Prevent** most 429s by pacing |
| SDK `maxRetries` + `withRateLimitRetry` | **Recover** when pacing wasn't enough |

On 429, reactive retry sleeps per `retry-after-ms` / headers. After sleep, bucket should also be updated (429 implies window is full — optionally call `syncFromHeaders` or pause all acquires for the suggested delay).

## Failure modes

| Case | Behavior |
|------|----------|
| `OPENAI_TPM_LIMIT` unset | No wrapper; existing behavior |
| Response missing `usage` | Record `estimate` as actual |
| 429 after retries exhausted | Propagate error; idempotency guard prevents orchestrator re-call in same run |
| Orchestrator + narrative concurrent | Same bucket — correct |

## Tests

### `src/lib/token-bucket.test.ts`

- acquire waits when window is full (fake timers)
- rolling window drops entries older than 60s
- record adjusts actual vs reserved
- syncFromHeaders lowers effective usage

### `src/lib/rate-limited-llm.test.ts`

- passes through when under limit without delay
- delays second call when first call fills window
- records usage from mock LLM response

### `src/lib/providers/openai.test.ts` (extend or new)

- parseResponse includes usage when present

### Integration

- Mock LLM with usage; run two rapid `generate` calls with TPM=5000, estimate=3000 — second call waits

## Migration / cleanup

After limiter ships:

1. Remove `NARRATIVE_LLM_CONCURRENCY` env and `narrativeConcurrency()` from generate-sprint-narrative
2. Remove `src/lib/concurrency.ts` if only used for narrative TPM (keep if used elsewhere)
3. Consolidate retry: one layer at provider (document in design decision)

## Open decisions

1. **Single retry layer** — prefer retry only in `OpenAILLM` (SDK + bucket-aware sleep on 429), remove `withRateLimitRetry` from narrative inner calls.
2. **Default estimate** — 3000 tokens is conservative for gpt-4o narrative calls with issue descriptions; tune via env.
3. **Enable by default?** — No; require explicit `OPENAI_TPM_LIMIT` so dev/prod tiers opt in.
