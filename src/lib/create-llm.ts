import type { LLM, LLMProvider } from "./llm.js";
import { openaiProvider } from "./providers/openai.js";
import { bedrockProvider } from "./providers/bedrock.js";
import { createRateLimitedLLM } from "./rate-limited-llm.js";
import { TokenBucket, tokenEstimate, tpmLimitFromEnv } from "./token-bucket.js";
import { createRoutingLLM } from "./routing-llm.js";
import {
  resolveModel,
  getDefaultLogicalModel,
  ensureModelConfigValid,
} from "./resolve-model.js";

const providers: Record<string, LLMProvider> = {
  openai: openaiProvider,
  bedrock: bedrockProvider,
};

export interface CreateLLMOptions {
  model?: string;
  apiKey?: string;
}

export function createLLM(options: CreateLLMOptions = {}): LLM {
  ensureModelConfigValid();

  const defaultLogicalModel = options.model ?? getDefaultLogicalModel();
  const backends: Record<string, () => LLM> = {};

  for (const name of Object.keys(providers)) {
    backends[name] = () => {
      const inner = providers[name].create({
        apiKey: name === "openai" ? options.apiKey : undefined,
      });
      return name === "openai" ? applyRateLimiting(inner, "openai") : inner;
    };
  }

  return createRoutingLLM({
    backends,
    defaultLogicalModel,
    resolve: resolveModel,
  });
}

function applyRateLimiting(llm: LLM, providerName: string): LLM {
  if (providerName !== "openai") return llm;

  const tpmLimit = tpmLimitFromEnv();
  if (tpmLimit == null) return llm;

  const bucket = new TokenBucket({ limit: tpmLimit });
  return createRateLimitedLLM(llm, bucket, tokenEstimate());
}
