import { describe, it, expect } from "vitest";
import {
  resolveBedrockModelId,
  formatBedrockModelList,
  type BedrockConfig,
} from "./bedrock-models.js";

const FIXTURE: BedrockConfig = {
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
    "haiku-4.5": {
      label: "Claude Haiku 4.5",
      bedrockModelId: "anthropic.claude-haiku-4-5-20251001-v1-0",
      ssmPath:
        "/developer/bedrock/anthropic.claude-haiku-4-5-20251001-v1-0/inference_profile_id",
      inferenceProfileArn:
        "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/example-haiku-profile",
    },
  },
};

describe("resolveBedrockModelId", () => {
  it("resolves a model key to an inference profile ARN", () => {
    const result = resolveBedrockModelId({
      config: FIXTURE,
      modelKey: "haiku-4.5",
    });
    expect(result.modelKey).toBe("haiku-4.5");
    expect(result.modelId).toBe(FIXTURE.models["haiku-4.5"].inferenceProfileArn);
    expect(result.label).toBe("Claude Haiku 4.5");
  });

  it("uses config default when model key is omitted", () => {
    const result = resolveBedrockModelId({ config: FIXTURE });
    expect(result.modelKey).toBe("sonnet-4.6");
    expect(result.modelId).toBe(FIXTURE.models["sonnet-4.6"].inferenceProfileArn);
  });

  it("prefers BEDROCK_MODEL_ID override", () => {
    const arn =
      "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/example-override-profile";
    const result = resolveBedrockModelId({
      config: FIXTURE,
      modelKey: "sonnet-4.6",
      modelIdOverride: arn,
    });
    expect(result.modelId).toBe(arn);
    expect(result.modelKey).toBeNull();
  });

  it("throws for unknown model keys", () => {
    expect(() =>
      resolveBedrockModelId({ config: FIXTURE, modelKey: "gpt-4" }),
    ).toThrow('Unknown BEDROCK_MODEL "gpt-4"');
  });
});

describe("formatBedrockModelList", () => {
  it("includes human-readable keys and ARNs", () => {
    const text = formatBedrockModelList(FIXTURE);
    expect(text).toContain("haiku-4.5");
    expect(text).toContain("Claude Haiku 4.5");
    expect(text).toContain("anthropic.claude-haiku-4-5-20251001-v1-0");
    expect(text).toContain("example-haiku-profile");
    expect(text).toContain("(default)");
  });
});
