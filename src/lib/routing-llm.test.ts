import { describe, it, expect, vi } from "vitest";
import { createRoutingLLM } from "./routing-llm.js";
import type { LLM, LLMResponse } from "./llm.js";

function mockBackend(name: string): LLM {
  return {
    generate: vi.fn(async (_messages, options) => ({
      content: `${name}:${options?.model}`,
      toolCalls: [],
      finishReason: "stop" as const,
    })),
    generateWithTools: vi.fn(async (_messages, _tools, options) => ({
      content: `${name}-tools:${options?.model}`,
      toolCalls: [],
      finishReason: "stop" as const,
    })),
  };
}

describe("createRoutingLLM", () => {
  it("routes generate to the backend for the resolved provider", async () => {
    const openai = mockBackend("openai");
    const bedrock = mockBackend("bedrock");

    const llm = createRoutingLLM({
      defaultLogicalModel: "gpt-4o",
      resolve: (logical) => {
        if (logical === "gpt-4o") return { logicalName: logical, provider: "openai", modelId: "gpt-4o" };
        if (logical === "sonnet-4.6") return { logicalName: logical, provider: "bedrock", modelId: "sonnet-4.6" };
        throw new Error(`unknown ${logical}`);
      },
      backends: {
        openai: () => openai,
        bedrock: () => bedrock,
      },
    });

    const openaiResult = await llm.generate([], { model: "gpt-4o" });
    expect(openaiResult.content).toBe("openai:gpt-4o");
    expect(openai.generate).toHaveBeenCalledOnce();

    const bedrockResult = await llm.generate([], { model: "sonnet-4.6" });
    expect(bedrockResult.content).toBe("bedrock:sonnet-4.6");
    expect(bedrock.generate).toHaveBeenCalledOnce();
  });

  it("uses the default logical model when options.model is omitted", async () => {
    const openai = mockBackend("openai");
    const llm = createRoutingLLM({
      defaultLogicalModel: "gpt-4o",
      resolve: (logical) => ({
        logicalName: logical,
        provider: "openai",
        modelId: "gpt-4o",
      }),
      backends: { openai: () => openai },
    });

    await llm.generate([]);
    expect(openai.generate).toHaveBeenCalledWith([], { model: "gpt-4o" });
  });

  it("routes generateWithTools to the correct backend", async () => {
    const openai = mockBackend("openai");
    const llm = createRoutingLLM({
      defaultLogicalModel: "gpt-4o",
      resolve: (logical) => ({
        logicalName: logical,
        provider: "openai",
        modelId: "gpt-4o",
      }),
      backends: { openai: () => openai },
    });

    await llm.generateWithTools([], [], { model: "gpt-4o" });
    expect(openai.generateWithTools).toHaveBeenCalledWith([], [], { model: "gpt-4o" });
  });

  it("throws when route references an unregistered provider", async () => {
    const llm = createRoutingLLM({
      defaultLogicalModel: "sonnet-4.6",
      resolve: () => ({
        logicalName: "sonnet-4.6",
        provider: "bedrock",
        modelId: "sonnet-4.6",
      }),
      backends: {},
    });

    await expect(llm.generate([], { model: "sonnet-4.6" })).rejects.toThrow(
      'unknown provider "bedrock"',
    );
  });
});
