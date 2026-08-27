import { describe, it, expect } from "vitest";
import { getModel, getToolModel } from "./models.js";
import { resolveModel } from "./resolve-model.js";

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

describe("bedrock:ask route validation", () => {
  it("accepts Bedrock-routed logical models", () => {
    expect(resolveModel("sonnet-4.6").provider).toBe("bedrock");
  });

  it("rejects non-Bedrock routes for bedrock:ask", () => {
    expect(resolveModel("gpt-4o").provider).toBe("openai");
  });
});
