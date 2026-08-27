# Host-Agnostic Model Routing

## Purpose

Resolve logical model names (e.g. `sonnet-4.6`) to a provider and provider-native model identifier at runtime, so tools and config do not depend on which LLM host serves a given model. A single agent run MAY use different providers for different calls through one shared `context.llm` instance.

## Requirements

### Requirement: Logical model names in config

The system SHALL use host-agnostic logical names in `models.json` for defaults, agents, and tools.

#### Scenario: Tool references logical name [tested]

- GIVEN `models.json` sets `"generate_sprint_narrative": "sonnet-4.6"`
- WHEN `getToolModel("generate_sprint_narrative")` is called
- THEN it returns `"sonnet-4.6"`

#### Scenario: Agent references logical name [tested]

- GIVEN `models.json` sets `"agent": "gpt-4o"`
- WHEN `getModel("agent")` is called
- THEN it returns `"gpt-4o"`

### Requirement: Explicit routing table

The system SHALL define an explicit `routes` map in `models.json` that binds each logical model name to exactly one provider and `modelId`.

#### Scenario: OpenAI route [tested]

- GIVEN `routes["gpt-4o"]` is `{ "provider": "openai", "modelId": "gpt-4o" }`
- WHEN `resolveModel("gpt-4o")` is called
- THEN it returns `{ provider: "openai", modelId: "gpt-4o" }`

#### Scenario: Bedrock route [tested]

- GIVEN `routes["sonnet-4.6"]` is `{ "provider": "bedrock", "modelId": "sonnet-4.6" }`
- WHEN `resolveModel("sonnet-4.6")` is called
- THEN it returns `{ provider: "bedrock", modelId: "sonnet-4.6" }`

#### Scenario: Unknown logical name [tested]

- GIVEN no entry exists in `routes` for `"unknown-model"`
- WHEN `resolveModel("unknown-model")` is called
- THEN the system throws an error listing available logical model names

#### Scenario: Every assigned name has a route [tested]

- GIVEN a logical name appears in `default`, `agents`, or `tools`
- WHEN the harness loads model config
- THEN that name MUST have a corresponding entry in `routes`
- AND startup or first resolution SHALL fail with a clear error if a route is missing

### Requirement: Uniform modelId field

The routing table SHALL use `modelId` for all providers — not alternate field names such as `ref`.

#### Scenario: OpenAI modelId is API model string [tested]

- GIVEN an OpenAI route with `"modelId": "gpt-4o-mini"`
- WHEN the OpenAI provider receives that `modelId`
- THEN it passes `"gpt-4o-mini"` to the OpenAI API unchanged

#### Scenario: Bedrock modelId is bedrock.json key [tested]

- GIVEN a Bedrock route with `"modelId": "sonnet-4.6"`
- AND `bedrock.json` maps `"sonnet-4.6"` to an inference profile ARN
- WHEN the Bedrock provider receives that `modelId`
- THEN it resolves the ARN from `bedrock.json` before calling Converse

### Requirement: Per-call provider routing

The system SHALL route each LLM call to the provider named in the resolved route for `options.model`.

#### Scenario: Mixed providers in one run [tested]

- GIVEN routes for `"gpt-4o"` (openai) and `"sonnet-4.6"` (bedrock)
- AND a single `context.llm` from `createHarnessContext`
- WHEN the orchestrator calls `llm.generateWithTools(..., { model: "gpt-4o" })`
- AND generate_sprint_narrative calls `llm.generate(..., { model: "sonnet-4.6" })`
- THEN the OpenAI provider handles the first call
- AND the Bedrock provider handles the second call

#### Scenario: Default model when options.model omitted [tested]

- GIVEN `createLLM` was bootstrapped with default logical model `"gpt-4o"`
- WHEN `llm.generate(messages)` is called without `options.model`
- THEN the call is routed using `resolveModel("gpt-4o")`

### Requirement: Bedrock provider implements LLM interface

The Bedrock provider SHALL implement `generate` and `generateWithTools` using the Bedrock Converse API.

#### Scenario: Text generation [manual]

- GIVEN a resolved Bedrock route and valid AWS credentials
- WHEN `generate` is called with user messages
- THEN the provider invokes Converse and returns text content in `LLMResponse`

#### Scenario: Text generation (unit) [tested]

- GIVEN a mocked Converse response
- WHEN the Bedrock provider `generate` is called
- THEN it returns parsed text content in `LLMResponse`

#### Scenario: Tool use [tested]

- GIVEN tool definitions are supplied
- WHEN `generateWithTools` is called
- THEN the provider invokes Converse with tools
- AND returns tool calls or final text consistent with the `LLM` interface

#### Scenario: Missing bedrock.json entry [tested]

- GIVEN a Bedrock route with `"modelId": "sonnet-4.6"`
- AND `bedrock.json` has no entry for `"sonnet-4.6"`
- WHEN the Bedrock provider handles a call
- THEN it throws an error naming the missing key and pointing to `bedrock.example.json`

### Requirement: Harness-owned bootstrap

Entry points SHALL obtain LLM access through `createHarnessContext` / `createLLM`. Tools SHALL NOT import providers directly.

#### Scenario: Routing applied at factory [tested]

- GIVEN model routes are configured
- WHEN `createLLM()` is called without an injected mock
- THEN it returns a routing LLM that delegates to registered providers
- AND applies harness policy (e.g. OpenAI TPM wrapping) per provider as today

#### Scenario: Tests inject mock LLM [tested]

- GIVEN a test passes `llm: mockLlm` to `createHarnessContext`
- WHEN the context is created
- THEN `createLLM` is not called
- AND routing is skipped

### Requirement: OpenAI TPM policy unchanged

OpenAI TPM rate limiting SHALL continue to apply only to OpenAI-routed calls.

#### Scenario: Bedrock calls bypass OpenAI TPM bucket [tested]

- GIVEN `OPENAI_TPM_LIMIT` is set
- WHEN a call is routed to the Bedrock provider
- THEN the OpenAI token bucket is not charged for that call

### Requirement: bedrock:ask uses shared resolution

The `bedrock:ask` CLI SHALL resolve logical model names through the same routing and Bedrock config as the harness.

#### Scenario: Ask with logical name [manual]

- GIVEN `routes["sonnet-4.6"]` points to Bedrock
- AND `LLM_MODEL=sonnet-4.6` (or equivalent documented env) is set
- WHEN `npm run bedrock:ask -- 'hello'` runs
- THEN it resolves `"sonnet-4.6"` and invokes Converse with the matching inference profile ARN

#### Scenario: Ask with non-Bedrock route [tested]

- GIVEN `LLM_MODEL=gpt-4o` and that route points to OpenAI
- WHEN `npm run bedrock:ask` runs
- THEN it exits with an error explaining that `bedrock:ask` requires a Bedrock-routed model

### Requirement: No real company data in tests

Tests and committed examples SHALL use placeholder account IDs and inference profile identifiers only.

#### Scenario: Test fixtures [tested]

- GIVEN a test configures Bedrock routes or ARNs
- WHEN the test file is committed
- THEN it uses generic placeholders (e.g. account `123456789012`, profile `example-sonnet-profile`)
- AND does not contain real AWS account IDs or inference profile suffixes

## Out of scope

- Implicit provider selection from model name patterns
- Multiple providers per logical name with runtime fallback
- Bedrock TPM pacing
- Providers other than OpenAI and Bedrock
