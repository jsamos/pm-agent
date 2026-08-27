import { describe, it, expect, vi, afterEach } from "vitest";
import { createLLM } from "./create-llm.js";
import { createHarnessContext } from "./context.js";
import * as rateLimitedLlm from "./rate-limited-llm.js";
import * as createLlmModule from "./create-llm.js";
import * as models from "./models.js";
import * as routingLlm from "./routing-llm.js";

describe("createLLM", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns a routing LLM backed by registered providers", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const routingSpy = vi.spyOn(routingLlm, "createRoutingLLM");

    createLLM();
    expect(routingSpy).toHaveBeenCalledOnce();
    expect(routingSpy.mock.calls[0][0].backends).toHaveProperty("openai");
    expect(routingSpy.mock.calls[0][0].backends).toHaveProperty("bedrock");
  });

  it("wraps OpenAI with rate limiting when OPENAI_TPM_LIMIT is set", () => {
    vi.stubEnv("OPENAI_TPM_LIMIT", "30000");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const wrapSpy = vi.spyOn(rateLimitedLlm, "createRateLimitedLLM");
    const routingSpy = vi.spyOn(routingLlm, "createRoutingLLM");

    createLLM();

    const backends = routingSpy.mock.calls[0][0].backends;
    backends.openai();
    expect(wrapSpy).toHaveBeenCalledOnce();
  });

  it("does not wrap Bedrock with OpenAI TPM rate limiting", async () => {
    vi.stubEnv("OPENAI_TPM_LIMIT", "30000");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("AWS_PROFILE", "example-profile");

    const openaiGenerate = vi.fn(async () => ({
      content: "openai",
      toolCalls: [],
      finishReason: "stop" as const,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    }));
    const bedrockGenerate = vi.fn(async () => ({
      content: "bedrock",
      toolCalls: [],
      finishReason: "stop" as const,
    }));

    const wrapSpy = vi.spyOn(rateLimitedLlm, "createRateLimitedLLM");
    wrapSpy.mockImplementation((inner) => inner);

    const llm = routingLlm.createRoutingLLM({
      defaultLogicalModel: "gpt-4o",
      resolve: (logical) => {
        if (logical === "gpt-4o") return { logicalName: logical, provider: "openai", modelId: "gpt-4o" };
        return { logicalName: logical, provider: "bedrock", modelId: "sonnet-4.6" };
      },
      backends: {
        openai: () => ({ generate: openaiGenerate, generateWithTools: vi.fn() }),
        bedrock: () => ({ generate: bedrockGenerate, generateWithTools: vi.fn() }),
      },
    });

    await llm.generate([], { model: "sonnet-4.6" });
    expect(bedrockGenerate).toHaveBeenCalledOnce();
    expect(openaiGenerate).not.toHaveBeenCalled();
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

  it("passes agent model to createLLM when agentName is set", () => {
    vi.spyOn(models, "getModel").mockReturnValue("agent-model");
    const createSpy = vi.spyOn(createLlmModule, "createLLM").mockReturnValue(mockLlm);

    createHarnessContext({ agentName: "agent", config: {} });

    expect(models.getModel).toHaveBeenCalledWith("agent");
    expect(createSpy).toHaveBeenCalledWith({ model: "agent-model" });
  });

  it("passes explicit model to createLLM", () => {
    const createSpy = vi.spyOn(createLlmModule, "createLLM").mockReturnValue(mockLlm);

    createHarnessContext({
      agentName: "agent",
      model: "gpt-4o-mini",
      config: {},
    });

    expect(createSpy).toHaveBeenCalledWith({
      model: "gpt-4o-mini",
    });
  });

  it("does not call createLLM when llm is injected", () => {
    const createSpy = vi.spyOn(createLlmModule, "createLLM");

    createHarnessContext({ llm: mockLlm, config: {} });

    expect(createSpy).not.toHaveBeenCalled();
  });
});
