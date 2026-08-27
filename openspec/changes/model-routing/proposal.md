# Host-Agnostic Model Routing

## Intent

Let code and config refer to logical model names (e.g. `sonnet-4.6`, `gpt-4o`) without knowing which LLM host backs them. Narrative pipelines and other composite tools should set `"generate_sprint_narrative": "sonnet-4.6"` in `models.json` and have the harness route each call to the correct provider (OpenAI, Bedrock, etc.) at runtime.

Today, `models.json` stores provider-native OpenAI names, `createLLM` selects a single provider per run via `LLM_PROVIDER`, and Bedrock is a separate CLI path (`BEDROCK_MODEL`, `bedrock.json`). A single agent run cannot mix OpenAI orchestration with Bedrock narrative generation without manual wiring.

## Scope

- Extend `models.json` with an explicit **routes** table: logical name → `{ provider, modelId }`
- `resolveModel(logicalName)` — harness function returning provider + provider-native `modelId`
- **Routing LLM** — one `context.llm` instance that delegates per call based on `options.model`
- **Bedrock provider** — implement `LLM` (`generate`, `generateWithTools`) via Converse API; `modelId` is a key in `bedrock.json` resolved to an inference profile ARN at call time
- Register Bedrock in `createLLM`'s provider map; apply existing harness policy (TPM) per provider
- Narrative tools unchanged at call sites — only `models.json` tool entries change when switching hosts
- Align `bedrock:ask` CLI with shared `resolveModel` (logical names, not Bedrock-specific env)
- Tests with placeholder ARNs and account IDs only (per AGENTS.md)
- Update `openspec/specs/harness-architecture/spec.md` model-configuration section to describe logical routing

## Out of scope

- Anthropic API, local models, or providers beyond OpenAI and Bedrock
- Automatic provider inference from model name patterns (e.g. `gpt-*` → OpenAI) — routing MUST be explicit
- Multi-route fallbacks or A/B routing between providers for the same logical name
- Bedrock TPM rate limiting (defer; OpenAI TPM unchanged)
- Changing orchestrator prompts or narrative tool logic beyond config
- Committing account-specific inference profile ARNs (stay in gitignored `bedrock.json`)
