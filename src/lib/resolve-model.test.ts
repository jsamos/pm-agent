import { describe, it, expect } from "vitest";
import {
  resolveModel,
  validateModelConfig,
  loadModelsConfig,
  getDefaultLogicalModel,
  getModel,
  getToolModel,
  getToolLlmConfig,
  type ModelsConfig,
} from "./resolve-model.js";

const FIXTURE: ModelsConfig = {
  default: "gpt-4o",
  agents: { agent: "gpt-4o", helper: "gpt-4o-mini" },
  tools: {
    generate_sprint_narrative: {
      model: "sonnet-4.6",
      maxTokens: 8192,
      temperature: 0.3,
    },
    generate_epic_narrative: "sonnet-4.6",
  },
  routes: {
    "gpt-4o": { provider: "openai", modelId: "gpt-4o" },
    "gpt-4o-mini": { provider: "openai", modelId: "gpt-4o-mini" },
    "sonnet-4.6": { provider: "bedrock", modelId: "sonnet-4.6" },
  },
};

describe("resolveModel", () => {
  it("resolves an OpenAI route", () => {
    const result = resolveModel("gpt-4o", FIXTURE);
    expect(result).toEqual({
      logicalName: "gpt-4o",
      provider: "openai",
      modelId: "gpt-4o",
    });
  });

  it("resolves a Bedrock route", () => {
    const result = resolveModel("sonnet-4.6", FIXTURE);
    expect(result).toEqual({
      logicalName: "sonnet-4.6",
      provider: "bedrock",
      modelId: "sonnet-4.6",
    });
  });

  it("throws for unknown logical names", () => {
    expect(() => resolveModel("unknown-model", FIXTURE)).toThrow(
      'Unknown logical model "unknown-model"',
    );
  });
});

describe("getModel", () => {
  it("returns agent override when present", () => {
    expect(getModel("helper", FIXTURE)).toBe("gpt-4o-mini");
  });

  it("falls back to default for unknown agent", () => {
    expect(getModel("unknown", FIXTURE)).toBe("gpt-4o");
  });

  it("falls back to default when agentName is omitted", () => {
    expect(getModel(undefined, FIXTURE)).toBe("gpt-4o");
  });
});

describe("getToolModel", () => {
  it("returns tool override when present", () => {
    expect(getToolModel("generate_sprint_narrative", FIXTURE)).toBe("sonnet-4.6");
  });

  it("falls back to default for unknown tool", () => {
    expect(getToolModel("unknown_tool", FIXTURE)).toBe("gpt-4o");
  });
});

describe("getToolLlmConfig", () => {
  it("returns model and invoke options from object tool entry", () => {
    expect(getToolLlmConfig("generate_sprint_narrative", FIXTURE)).toEqual({
      model: "sonnet-4.6",
      maxTokens: 8192,
      temperature: 0.3,
    });
  });

  it("applies defaults for string tool entry", () => {
    expect(getToolLlmConfig("generate_epic_narrative", FIXTURE)).toEqual({
      model: "sonnet-4.6",
      maxTokens: 4096,
      temperature: 0.3,
    });
  });

  it("falls back to default model for unknown tool", () => {
    expect(getToolLlmConfig("unknown_tool", FIXTURE)).toEqual({
      model: "gpt-4o",
      maxTokens: 4096,
      temperature: 0.3,
    });
  });
});

describe("bedrock:ask model selection", () => {
  it("detects OpenAI-routed default", () => {
    const defaultModel = getDefaultLogicalModel(FIXTURE);
    expect(resolveModel(defaultModel, FIXTURE).provider).toBe("openai");
  });

  it("detects Bedrock-routed default", () => {
    const bedrockDefault: ModelsConfig = { ...FIXTURE, default: "sonnet-4.6" };
    const defaultModel = getDefaultLogicalModel(bedrockDefault);
    expect(resolveModel(defaultModel, bedrockDefault).provider).toBe("bedrock");
  });
});

describe("validateModelConfig", () => {
  it("passes when every assigned name has a route", () => {
    expect(() => validateModelConfig(FIXTURE)).not.toThrow();
  });

  it("throws when a tool references a name without a route", () => {
    const bad: ModelsConfig = {
      ...FIXTURE,
      tools: { generate_sprint_narrative: "opus-4.6" },
    };
    expect(() => validateModelConfig(bad)).toThrow("missing routes");
  });
});

describe("committed models.json", () => {
  it("has routes for all assigned logical names", () => {
    expect(() => validateModelConfig(loadModelsConfig())).not.toThrow();
  });
});
