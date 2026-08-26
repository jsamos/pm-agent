/**
 * Harness LLM factory — single entry point for provider selection,
 * rate limiting, and other cross-cutting LLM policy.
 */

import type { LLM, LLMProvider } from "./llm.js";
import { openaiProvider } from "./providers/openai.js";
import { createRateLimitedLLM } from "./rate-limited-llm.js";
import { TokenBucket, tokenEstimate, tpmLimitFromEnv } from "./token-bucket.js";

const providers: Record<string, LLMProvider> = {
  openai: openaiProvider,
};

export interface CreateLLMOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
}

export function createLLM(options: CreateLLMOptions = {}): LLM {
  const providerName = options.provider ?? process.env.LLM_PROVIDER ?? "openai";
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(
      `Unknown LLM provider "${providerName}". Supported: ${Object.keys(providers).join(", ")}`,
    );
  }

  const inner = provider.create({
    model: options.model,
    apiKey: options.apiKey,
  });

  return applyRateLimiting(inner, providerName);
}

function applyRateLimiting(llm: LLM, providerName: string): LLM {
  // v1: TPM pacing applies to OpenAI-backed calls only.
  if (providerName !== "openai") return llm;

  const tpmLimit = tpmLimitFromEnv();
  if (tpmLimit == null) return llm;

  const bucket = new TokenBucket({ limit: tpmLimit });
  return createRateLimitedLLM(llm, bucket, tokenEstimate());
}
