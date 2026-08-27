# Host-Agnostic Model Routing — Design

## Problem

```
models.json          createLLM (LLM_PROVIDER=openai)
     │                        │
     ▼                        ▼
"gpt-4o" only          single OpenAI LLM instance
                             │
generate_sprint_narrative ───┘  (cannot say "sonnet-4.6" → Bedrock)

bedrock:ask CLI  ──►  BEDROCK_MODEL + bedrock.json  (separate path)
```

Tools already pass `model: getToolModel(...)` per call, but the shared LLM is always OpenAI and names in config are OpenAI API strings. Bedrock is isolated to a smoke-test CLI.

## Target architecture

```
models.json
  default / agents / tools  →  logical names ("sonnet-4.6", "gpt-4o")
  routes                    →  { provider, modelId } per logical name

getToolModel("generate_sprint_narrative")  →  "sonnet-4.6"
        │
        ▼
context.llm.generate(..., { model: "sonnet-4.6" })
        │
        ▼
RoutingLLM
  resolveModel("sonnet-4.6")  →  { provider: "bedrock", modelId: "sonnet-4.6" }
        │
        ├── openai backend  →  modelId passed to OpenAI API
        └── bedrock backend →  bedrock.json["sonnet-4.6"] → ARN → Converse
```

One `context.llm` per run. Provider selection is **per call** from the explicit routes table — not from `LLM_PROVIDER`.

## Configuration

### Extended `src/config/models.json`

```json
{
  "default": "gpt-4o",
  "agents": {
    "agent": "gpt-4o"
  },
  "tools": {
    "generate_epic_narrative": "sonnet-4.6",
    "generate_sprint_narrative": "sonnet-4.6"
  },
  "routes": {
    "gpt-4o":      { "provider": "openai",  "modelId": "gpt-4o" },
    "gpt-4o-mini": { "provider": "openai",  "modelId": "gpt-4o-mini" },
    "sonnet-4.6":  { "provider": "bedrock", "modelId": "sonnet-4.6" },
    "sonnet-5":    { "provider": "bedrock", "modelId": "sonnet-5" },
    "haiku-4.5":   { "provider": "bedrock", "modelId": "haiku-4.5" },
    "opus-4.6":    { "provider": "bedrock", "modelId": "opus-4.6" }
  }
}
```

**Rules:**

- Keys in `default`, `agents`, and `tools` are **logical names** — opaque to callers.
- Every referenced logical name MUST have a `routes` entry.
- `modelId` is always the provider-native identifier:
  - **openai** — API model string (same as logical name today, but decoupled for future renames)
  - **bedrock** — key in gitignored `bedrock.json` (resolved to inference profile ARN at call time)

### `src/config/bedrock.json` (unchanged role)

Account-specific ARNs stay gitignored. The Bedrock provider looks up `modelId` as a key:

```
routes["sonnet-4.6"].modelId  →  "sonnet-4.6"
bedrock.json.models["sonnet-4.6"].inferenceProfileArn  →  arn:...
```

Optional env override `BEDROCK_MODEL_ID` (raw ARN) remains a Bedrock-provider escape hatch for debugging; not used by the routing table.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI auth (unchanged) |
| `OPENAI_TPM_LIMIT` | TPM pacing for OpenAI-routed calls only (unchanged) |
| `AWS_PROFILE`, `AWS_REGION` | Bedrock auth (unchanged) |
| `LLM_MODEL` | Optional override for default logical model (replaces `BEDROCK_MODEL` in harness/CLI) |

**Remove / deprecate:**

| Variable | Replacement |
|----------|-------------|
| `LLM_PROVIDER` | Explicit `routes` — no single-provider switch |
| `BEDROCK_MODEL` | `LLM_MODEL` or `models.json` default |

## New and modified files

### New: `src/lib/resolve-model.ts`

```typescript
export interface ModelRoute {
  provider: string;
  modelId: string;
}

export interface ResolvedModel {
  logicalName: string;
  provider: string;
  modelId: string;
}

export function resolveModel(logicalName: string): ResolvedModel;
export function validateModelConfig(config: ModelsConfig): void;  // all assigned names have routes
```

Loads routes from `models.json`. Throws with sorted list of available logical names on unknown input.

### New: `src/lib/routing-llm.ts`

```typescript
function createRoutingLLM(options: {
  backends: Record<string, LLM>;
  defaultLogicalModel: string;
  resolve: typeof resolveModel;
}): LLM;
```

Both `generate` and `generateWithTools`:

1. `logical = options?.model ?? defaultLogicalModel`
2. `{ provider, modelId } = resolve(logical)`
3. `backends[provider].generate(..., { ...options, model: modelId })`

Log routed provider to stderr (optional, for tracing): `[llm] sonnet-4.6 → bedrock`.

### New: `src/lib/providers/bedrock.ts`

Bedrock `LLMProvider` implementation.

- Reuse Converse invocation pattern from `src/scripts/bedrock-ask.ts` (AWS CLI or SDK — prefer SDK for tool-use parsing if already adding a dependency; otherwise shell out like today and extend for tools in a follow-up).
- **v1 recommendation:** start with AWS CLI for `generate` (narrative path); add `generateWithTools` via SDK or CLI tool config as needed for agent loop on Bedrock.
- `create({ modelId })` — stores default bedrock.json key; per-call `options.model` overrides.
- Internal: `resolveBedrockArn(modelId)` — lookup in `bedrock.json`, honor `BEDROCK_MODEL_ID` env override only when modelId is absent (CLI debug path).

### Modified: `src/lib/create-llm.ts`

```typescript
const providers = {
  openai: openaiProvider,
  bedrock: bedrockProvider,
};

export function createLLM(options: CreateLLMOptions = {}): LLM {
  const backends: Record<string, LLM> = {};
  for (const [name, provider] of Object.entries(providers)) {
    const inner = provider.create({});
    backends[name] = name === "openai" ? applyRateLimiting(inner, "openai") : inner;
  }
  const defaultLogical = options.model ?? getModel(/* agent if needed */);
  return createRoutingLLM({ backends, defaultLogicalModel: defaultLogical, resolve: resolveModel });
}
```

Remove `LLM_PROVIDER` selection of a single backend. All registered providers are initialized; routing picks per call.

### Modified: `src/lib/models.ts`

- Extend types for `routes` section.
- Export `getRoutes()` or load full config for `resolveModel`.
- `validateModelConfig()` on load (dev-friendly early failure).

### Modified: `src/lib/bedrock-models.ts`

- Rename / generalize `resolveBedrockModelId` → used internally by Bedrock provider only.
- `bedrock:ask` and `bedrock:models` scripts unchanged in purpose; `bedrock:ask` calls `resolveModel` then verifies `provider === "bedrock"`.

### Modified: `src/scripts/bedrock-ask.ts`

- Read logical name from `LLM_MODEL` env or `models.json` default.
- `resolveModel(name)` → assert bedrock → existing Converse flow with resolved ARN.

### Modified: `.env.example`, `README.md`

- Document `LLM_MODEL`, remove `BEDROCK_MODEL` / `LLM_PROVIDER` as primary selectors.
- Document `models.json` routes table.

### Modified: `openspec/specs/harness-architecture/spec.md`

Update **Model configuration** and **New LLM providers** sections:

- Logical names + explicit routes replace `LLM_PROVIDER` per-run selection.
- Bedrock registered alongside OpenAI.
- Per-call routing through one shared `context.llm`.

## Tool code changes

**None required** for narrative generators — they already call:

```typescript
context.llm.generate([...], { model: getToolModel("generate_sprint_narrative"), ... });
```

Only `models.json` changes to point tools at `"sonnet-4.6"`.

## Bootstrap flow (updated)

```
Entry point
  → createHarnessContext({ agentName, config })
    → createLLM({ model: getModel(agentName) })
      → create openai + bedrock backends
      → applyRateLimiting on openai only
      → createRoutingLLM({ backends, defaultLogicalModel })
    → createContext({ llm })
  → agent loop / tool.execute
    → llm.generateWithTools(..., { model: "gpt-4o" })       // orchestrator
    → llm.generate(..., { model: "sonnet-4.6" })            // narrative
```

## Bedrock provider: generate vs generateWithTools

| Method | Needed for | v1 approach |
|--------|------------|-------------|
| `generate` | Narrative tools | Required — ship first |
| `generateWithTools` | Agent loop on Bedrock | Required for provider completeness; implement Converse tool-use or stub with clear error until agent runs on Bedrock |

Agent orchestrator stays on OpenAI in v1; `generateWithTools` on Bedrock can be implemented for interface compliance and future use. Spec requires both methods exist; tests mock Converse responses.

## Tests

### `src/lib/resolve-model.test.ts`

- Resolves openai and bedrock routes
- Unknown name throws with available list
- validateModelConfig catches missing route for assigned tool name
- Placeholder data only

### `src/lib/routing-llm.test.ts`

- Routes to correct mock backend based on `options.model`
- Uses default logical model when omitted
- Mixed calls in sequence hit different backends

### `src/lib/providers/bedrock.test.ts`

- Mock Converse / CLI output parsing
- modelId key → ARN lookup from fixture bedrock config
- Missing bedrock.json key throws

### `src/lib/create-llm.test.ts` (extend)

- Returns routing LLM (not raw OpenAI)
- OpenAI TPM wrapper only on openai backend
- Unknown provider in routes fails at resolve time, not factory time

### `src/lib/bedrock-models.test.ts`

- Keep placeholder ARNs (already fixed)

## Migration

1. Add `routes` to `models.json` with entries for all current OpenAI models (logical name = route for now).
2. Add Bedrock routes for models you plan to use (`sonnet-4.6`, etc.).
3. Flip narrative tool entries to `"sonnet-4.6"` when Bedrock provider is ready.
4. Update `.env`: remove `BEDROCK_MODEL`, use `LLM_MODEL` if overriding default.
5. Remove `LLM_PROVIDER` from docs and code paths.

## Implementation order

1. `resolveModel` + config validation + tests
2. `RoutingLLM` + tests
3. Refactor `createLLM` to use routing (OpenAI-only routes — behavior unchanged)
4. Bedrock provider (`generate`, then `generateWithTools`)
5. Wire `models.json` routes; flip narrative tools
6. Update `bedrock:ask`, `.env.example`, README
7. Update harness-architecture spec
8. Mark spec scenarios `[tested]` as coverage lands

## Open decisions

1. **Bedrock transport** — AWS SDK vs CLI shell-out. CLI matches today and avoids new deps; SDK better for tool-use parsing. Recommend SDK if `generateWithTools` is in v1 scope; otherwise CLI for `generate` + SDK follow-up for tools.
2. **LLM_MODEL vs models.json only** — keep env override for CLI convenience; default always from `models.json`.
3. **Lazy vs eager backend init** — eager init both providers at `createLLM` (simple; fails fast on missing OPENAI_API_KEY even when run only uses Bedrock). Alternative: lazy init on first routed call — defer unless eager causes pain.
