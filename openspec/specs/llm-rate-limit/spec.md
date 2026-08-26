# LLM TPM Rate Limiting

## Purpose

Pace all LLM requests in a single agent process against a configurable tokens-per-minute (TPM) budget so parallel narrative generation and orchestrator calls do not burst past OpenAI org limits. Proactive pacing is the primary mechanism; reactive 429 retry is a fallback.

## Requirements

### Requirement: TPM configuration

The system SHALL support an explicit TPM limit for OpenAI-backed LLM calls.

#### Scenario: Limit configured [tested]

- GIVEN `OPENAI_TPM_LIMIT` is set to 30000
- WHEN the OpenAI LLM provider is created
- THEN all `generate` and `generateWithTools` calls pass through a rate limiter using that budget

#### Scenario: Limit not configured [tested]

- GIVEN `OPENAI_TPM_LIMIT` is unset
- WHEN the OpenAI LLM provider is created
- THEN LLM calls behave as today (no proactive pacing)

### Requirement: Shared process budget

The system SHALL apply one TPM budget to all LLM calls within a single agent process.

#### Scenario: Orchestrator and narrative share budget [tested]

- GIVEN `OPENAI_TPM_LIMIT` is set
- WHEN the orchestrator makes an LLM call and generate_sprint_narrative makes multiple inner LLM calls in the same run
- THEN all calls draw from the same rolling token window
- AND combined usage SHALL NOT exceed the configured limit without waiting

### Requirement: Proactive pacing

The system SHALL wait before starting an LLM call when the rolling window would exceed the TPM limit.

#### Scenario: Call proceeds when headroom exists [tested]

- GIVEN the rolling 60-second window has used fewer tokens than the limit minus the reservation estimate
- WHEN an LLM call is requested
- THEN the call proceeds without delay

#### Scenario: Call waits when window is full [tested]

- GIVEN the rolling 60-second window has consumed tokens such that the next reservation would exceed the limit
- WHEN an LLM call is requested
- THEN the system waits until enough tokens expire from the window
- AND then proceeds with the call
- AND logs a brief wait message to stderr

### Requirement: Usage accounting

The system SHALL record actual token usage after each successful LLM response.

#### Scenario: Usage from OpenAI response [tested]

- GIVEN an OpenAI completion returns `usage.prompt_tokens` and `usage.completion_tokens`
- WHEN the call completes successfully
- THEN the rate limiter records `prompt_tokens + completion_tokens` against the rolling window
- AND adjusts any pre-call reservation to match actual usage

#### Scenario: Usage missing [tested]

- GIVEN a completion response does not include usage
- WHEN the call completes successfully
- THEN the rate limiter records the pre-call reservation estimate as actual usage

### Requirement: Pre-call reservation

The system SHALL reserve an estimated token count before each call to prevent parallel callers from overshooting the limit.

#### Scenario: Default estimate [tested]

- GIVEN `LLM_TOKEN_ESTIMATE` is unset
- WHEN an LLM call is about to start
- THEN the system reserves a conservative default estimate (SHALL be configurable, default approximately 3000 tokens)

#### Scenario: Custom estimate [tested]

- GIVEN `LLM_TOKEN_ESTIMATE` is set to 5000
- WHEN an LLM call is about to start
- THEN the system reserves 5000 tokens before the call

### Requirement: Reactive retry fallback

The system SHALL retain reactive retry on HTTP 429 when proactive pacing is insufficient.

#### Scenario: 429 after pacing [tested]

- GIVEN proactive pacing is enabled
- WHEN OpenAI returns 429 despite pacing
- THEN the system retries with provider-suggested delay (retry-after-ms or equivalent)
- AND retries up to `LLM_MAX_RETRIES`

#### Scenario: Retries exhausted [tested]

- GIVEN all reactive retries are exhausted
- WHEN OpenAI still returns 429
- THEN the error propagates to the caller

### Requirement: Provider header calibration

The system MAY adjust internal bucket state from OpenAI rate-limit response headers when present.

#### Scenario: Remaining tokens header [tested]

- GIVEN a successful OpenAI response includes `x-ratelimit-remaining-tokens`
- WHEN the call completes
- THEN the rate limiter MAY sync its internal state to align with provider-reported remaining budget

### Requirement: Narrative generation does not implement separate TPM logic

The system SHALL NOT use narrative-specific concurrency caps as the primary TPM throttle once this feature ships.

#### Scenario: No NARRATIVE_LLM_CONCURRENCY throttle [tested]

- GIVEN TPM rate limiting is enabled via `OPENAI_TPM_LIMIT`
- WHEN generate_sprint_narrative runs inner LLM calls
- THEN pacing is handled by the shared LLM rate limiter
- AND narrative-specific concurrency env vars SHALL NOT be required for correct TPM behavior

## Out of scope

- RPM (requests per minute) limiting
- tiktoken-based pre-call estimation
- Multi-process coordination
- Non-OpenAI provider TPM limits in v1
