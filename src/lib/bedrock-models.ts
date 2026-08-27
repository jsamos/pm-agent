import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface BedrockModelEntry {
  label: string;
  bedrockModelId: string;
  ssmPath: string;
  inferenceProfileArn: string;
}

export interface BedrockConfig {
  region?: string;
  default?: string;
  models: Record<string, BedrockModelEntry>;
}

const CONFIG_DIR = join(process.cwd(), "src", "config");

export function bedrockConfigPath(): string {
  const local = join(CONFIG_DIR, "bedrock.json");
  if (existsSync(local)) return local;
  throw new Error(
    "src/config/bedrock.json not found. Copy src/config/bedrock.example.json to src/config/bedrock.json " +
      "and set inference profile ARNs for your AWS account.",
  );
}

export function loadBedrockConfig(): BedrockConfig {
  const raw = readFileSync(bedrockConfigPath(), "utf8");
  return JSON.parse(raw) as BedrockConfig;
}

export function resolveBedrockModelId(options: {
  config: BedrockConfig;
  modelKey?: string;
  modelIdOverride?: string;
}): { modelKey: string | null; modelId: string; label: string | null } {
  if (options.modelIdOverride?.trim()) {
    return {
      modelKey: null,
      modelId: options.modelIdOverride.trim(),
      label: null,
    };
  }

  const key = options.modelKey?.trim() || options.config.default;
  if (!key) {
    throw new Error("No Bedrock model selected. Set BEDROCK_MODEL in .env or BEDROCK_MODEL_ID.");
  }

  const entry = options.config.models[key];
  if (!entry) {
    const available = Object.keys(options.config.models).sort().join(", ");
    throw new Error(`Unknown BEDROCK_MODEL "${key}". Available: ${available}`);
  }

  return {
    modelKey: key,
    modelId: entry.inferenceProfileArn,
    label: entry.label,
  };
}

export function formatBedrockModelList(config: BedrockConfig): string {
  const lines: string[] = [];
  const defaultKey = config.default;

  lines.push("Bedrock models (src/config/bedrock.json):\n");
  lines.push(
    `${"Key".padEnd(12)} ${"Label".padEnd(22)} Bedrock model ID`,
  );
  lines.push("-".repeat(76));

  for (const [key, entry] of Object.entries(config.models).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const mark = key === defaultKey ? " (default)" : "";
    lines.push(
      `${key.padEnd(12)} ${entry.label.padEnd(22)} ${entry.bedrockModelId}${mark}`,
    );
  }

  lines.push("");
  lines.push("Inference profile ARNs:\n");

  for (const [key, entry] of Object.entries(config.models).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(`${key}:`);
    lines.push(`  ${entry.inferenceProfileArn}`);
    lines.push(`  ssm: ${entry.ssmPath}`);
    lines.push("");
  }

  lines.push("Usage:");
  lines.push("  Copy bedrock.example.json → bedrock.json and set ARNs for your AWS account.");
  lines.push("  ARNs from SSM must match the account in AWS_PROFILE.");
  lines.push("  BEDROCK_MODEL=sonnet-4.6 npm run bedrock:ask -- 'your prompt'");
  lines.push("  npm run bedrock:models");

  return lines.join("\n");
}
