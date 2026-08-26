import { describe, it, expect, vi, afterEach } from "vitest";
import { openaiProvider } from "./openai.js";
import * as rateLimitedLlm from "../rate-limited-llm.js";

describe("openaiProvider.create", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not apply rate limiting — that is handled by createLLM", () => {
    vi.stubEnv("OPENAI_TPM_LIMIT", "30000");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const wrapSpy = vi.spyOn(rateLimitedLlm, "createRateLimitedLLM");

    const llm = openaiProvider.create();
    expect(typeof llm.generate).toBe("function");
    expect(wrapSpy).not.toHaveBeenCalled();
  });
});
