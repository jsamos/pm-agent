import { describe, it, expect } from "vitest";
import { getModel, getToolModel } from "./models.js";
import { resolveModel, getDefaultLogicalModel } from "./resolve-model.js";

describe("getToolModel", () => {
  it("returns logical model names from models.json", () => {
    expect(getToolModel("generate_sprint_narrative")).toBe("sonnet-4.6");
    expect(getToolModel("generate_epic_narrative")).toBe("sonnet-4.6");
  });
});

describe("getModel", () => {
  it("returns logical model names for agents", () => {
    expect(getModel("agent")).toBe("gpt-4o");
  });
});

describe("bedrock:ask model selection", () => {
  it("uses models.json default as the logical model", () => {
    expect(getDefaultLogicalModel()).toBe("gpt-4o");
  });

  it("rejects non-Bedrock defaults", () => {
    expect(resolveModel(getDefaultLogicalModel()).provider).toBe("openai");
  });

  it("accepts Bedrock-routed logical models", () => {
    expect(resolveModel("sonnet-4.6").provider).toBe("bedrock");
  });
});
