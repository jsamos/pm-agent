import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BedrockConfig } from "../bedrock-models.js";

vi.mock("../bedrock-converse.js", () => ({
  bedrockConverse: vi.fn(),
  parseConverseResponse: vi.fn(),
}));

import { bedrockProvider } from "./bedrock.js";
import { bedrockConverse, parseConverseResponse } from "../bedrock-converse.js";

const FIXTURE_CONFIG: BedrockConfig = {
  region: "us-east-1",
  default: "sonnet-4.6",
  models: {
    "sonnet-4.6": {
      label: "Claude Sonnet 4.6",
      bedrockModelId: "anthropic.claude-sonnet-4-6",
      ssmPath: "/developer/bedrock/anthropic.claude-sonnet-4-6/inference_profile_id",
      inferenceProfileArn:
        "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/example-sonnet-profile",
    },
  },
};

vi.mock("../bedrock-models.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bedrock-models.js")>();
  return {
    ...actual,
    loadBedrockConfig: () => FIXTURE_CONFIG,
  };
});

describe("bedrockProvider", () => {
  beforeEach(() => {
    vi.stubEnv("AWS_PROFILE", "example-profile");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.mocked(bedrockConverse).mockResolvedValue({ output: { message: { content: [] } } });
    vi.mocked(parseConverseResponse).mockReturnValue({
      content: "Hello",
      toolCalls: [],
      finishReason: "stop",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("invokes Converse with the resolved inference profile ARN", async () => {
    const llm = bedrockProvider.create();
    await llm.generate([{ role: "user", content: "hi" }], { model: "sonnet-4.6" });

    expect(bedrockConverse).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId:
          "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/example-sonnet-profile",
        profile: "example-profile",
        region: "us-east-1",
      }),
    );
  });

  it("supports generateWithTools", async () => {
    vi.mocked(parseConverseResponse).mockReturnValue({
      content: null,
      toolCalls: [{ id: "t1", name: "load_skill", arguments: { name: "test" } }],
      finishReason: "tool_calls",
    });

    const llm = bedrockProvider.create();
    const response = await llm.generateWithTools(
      [{ role: "user", content: "go" }],
      [{ name: "load_skill", description: "Load skill", parameters: { type: "object", properties: {} } }],
      { model: "sonnet-4.6" },
    );

    expect(bedrockConverse).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "load_skill" }),
        ]),
      }),
    );
    expect(response.finishReason).toBe("tool_calls");
  });

  it("throws when bedrock.json has no entry for the model key", async () => {
    const llm = bedrockProvider.create();
    await expect(
      llm.generate([{ role: "user", content: "hi" }], { model: "missing-key" }),
    ).rejects.toThrow('Unknown Bedrock model key "missing-key"');
  });
});
