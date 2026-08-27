import { describe, it, expect } from "vitest";
import {
  resolveModel,
  validateModelConfig,
  loadModelsConfig,
  type ModelsConfig,
} from "./resolve-model.js";

const FIXTURE: ModelsConfig = {
  default: "gpt-4o",
  agents: { agent: "gpt-4o" },
  tools: { generate_sprint_narrative: "sonnet-4.6" },
  routes: {
    "gpt-4o": { provider: "openai", modelId: "gpt-4o" },
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
