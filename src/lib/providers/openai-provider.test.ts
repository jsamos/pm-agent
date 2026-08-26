import { describe, it, expect, vi, afterEach } from "vitest";
import { openaiProvider } from "./openai.js";

describe("openaiProvider.create", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates an LLM without rate limiting when OPENAI_TPM_LIMIT is unset", () => {
    delete process.env.OPENAI_TPM_LIMIT;
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const llm = openaiProvider.create();
    expect(typeof llm.generate).toBe("function");
    expect(typeof llm.generateWithTools).toBe("function");
  });

  it("wraps with rate limiter when OPENAI_TPM_LIMIT is set", () => {
    vi.stubEnv("OPENAI_TPM_LIMIT", "30000");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const llm = openaiProvider.create();
    expect(typeof llm.generate).toBe("function");
    expect(typeof llm.generateWithTools).toBe("function");
  });
});
