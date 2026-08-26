import { describe, it, expect, vi, afterEach } from "vitest";
import { createLLM } from "./create-llm.js";
import { createHarnessContext } from "./context.js";
import * as rateLimitedLlm from "./rate-limited-llm.js";
import * as createLlmModule from "./create-llm.js";

describe("createLLM", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("creates an LLM without rate limiting when OPENAI_TPM_LIMIT is unset", () => {
    delete process.env.OPENAI_TPM_LIMIT;
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const wrapSpy = vi.spyOn(rateLimitedLlm, "createRateLimitedLLM");

    const llm = createLLM();
    expect(typeof llm.generate).toBe("function");
    expect(wrapSpy).not.toHaveBeenCalled();
  });

  it("wraps with rate limiter when OPENAI_TPM_LIMIT is set", () => {
    vi.stubEnv("OPENAI_TPM_LIMIT", "30000");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const wrapSpy = vi.spyOn(rateLimitedLlm, "createRateLimitedLLM");

    const llm = createLLM();
    expect(wrapSpy).toHaveBeenCalledOnce();
    expect(typeof llm.generate).toBe("function");
  });

  it("throws for an unknown provider", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(() => createLLM({ provider: "unknown" })).toThrow('Unknown LLM provider "unknown"');
  });

  it("respects LLM_PROVIDER env", () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const llm = createLLM();
    expect(typeof llm.generate).toBe("function");
  });
});

describe("createHarnessContext", () => {
  const mockLlm = {
    generate: vi.fn(),
    generateWithTools: vi.fn(),
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("creates context with harness-managed LLM when llm is omitted", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const context = createHarnessContext({
      agentName: "agent",
      config: {},
      workflowName: "test",
      stepName: "run",
    });
    expect(context.llm).toBeDefined();
    expect(typeof context.llm.generate).toBe("function");
  });

  it("uses injected llm when provided", () => {
    const context = createHarnessContext({
      llm: mockLlm,
      config: {},
    });
    expect(context.llm).toBe(mockLlm);
  });

  it("passes agentName to createLLM as model from models.json", () => {
    const createSpy = vi.spyOn(createLlmModule, "createLLM").mockReturnValue(mockLlm);

    createHarnessContext({ agentName: "agent", config: {} });

    expect(createSpy).toHaveBeenCalledWith({
      provider: undefined,
      model: "gpt-4o",
    });
  });

  it("passes explicit model and provider to createLLM", () => {
    const createSpy = vi.spyOn(createLlmModule, "createLLM").mockReturnValue(mockLlm);

    createHarnessContext({
      agentName: "agent",
      model: "gpt-4o-mini",
      provider: "openai",
      config: {},
    });

    expect(createSpy).toHaveBeenCalledWith({
      provider: "openai",
      model: "gpt-4o-mini",
    });
  });

  it("does not call createLLM when llm is injected", () => {
    const createSpy = vi.spyOn(createLlmModule, "createLLM");

    createHarnessContext({ llm: mockLlm, config: {} });

    expect(createSpy).not.toHaveBeenCalled();
  });
});
