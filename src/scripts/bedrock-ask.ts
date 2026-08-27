/**
 * Send a prompt to Bedrock Converse via the AWS CLI.
 * Config is loaded from .env and src/config/bedrock.json.
 *
 * Usage:
 *   npm run bedrock:ask -- 'Say hello in one word.'
 *   BEDROCK_MODEL=opus-4.6 npm run bedrock:ask -- '...'
 *   npm run bedrock:models   # list model keys and ARNs
 */

import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadBedrockConfig, resolveBedrockModelId } from "../lib/bedrock-models.js";

const execFileAsync = promisify(execFile);

interface ConverseOutput {
  output?: {
    message?: {
      content?: Array<{ text?: string }>;
    };
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  stopReason?: string;
}

function extractText(response: ConverseOutput): string {
  const blocks = response.output?.message?.content ?? [];
  const text = blocks.map((b) => b.text ?? "").join("").trim();
  if (!text) {
    throw new Error(
      `No text in Bedrock response: ${JSON.stringify(response).slice(0, 500)}`,
    );
  }
  return text;
}

function usage(): void {
  process.stderr.write(
    "Usage: npm run bedrock:ask -- '<your prompt>'\n\n" +
      "Requires in .env:\n" +
      "  AWS_PROFILE\n" +
      "  BEDROCK_MODEL (e.g. sonnet-4.6, sonnet-5, haiku-4.5, opus-4.6) — see npm run bedrock:models\n\n" +
      "Optional:\n" +
      "  BEDROCK_MODEL_ID — override with a raw inference profile ARN\n" +
      "  AWS_REGION\n" +
      "  BEDROCK_MAX_TOKENS\n",
  );
}

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) {
    usage();
    process.exit(1);
  }

  const profile = process.env.AWS_PROFILE;
  if (!profile) {
    process.stderr.write("Missing AWS_PROFILE in .env\n");
    process.exit(1);
  }

  const config = loadBedrockConfig();
  const region = process.env.AWS_REGION ?? config.region ?? "us-east-1";
  const maxTokens = Number(process.env.BEDROCK_MAX_TOKENS ?? 1024);

  const resolved = resolveBedrockModelId({
    config,
    modelKey: process.env.BEDROCK_MODEL,
    modelIdOverride: process.env.BEDROCK_MODEL_ID,
  });

  const messages = JSON.stringify([
    { role: "user", content: [{ text: prompt }] },
  ]);
  const inferenceConfig = JSON.stringify({
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 1024,
  });

  const modelNote = resolved.modelKey
    ? `${resolved.modelKey} (${resolved.label})`
    : "custom ARN";

  const start = Date.now();

  try {
    const { stdout } = await execFileAsync(
      "aws",
      [
        "bedrock-runtime",
        "converse",
        "--model-id",
        resolved.modelId,
        "--messages",
        messages,
        "--inference-config",
        inferenceConfig,
        "--region",
        region,
        "--profile",
        profile,
        "--output",
        "json",
      ],
      { env: process.env, maxBuffer: 10 * 1024 * 1024 },
    );

    const response = JSON.parse(stdout) as ConverseOutput;
    const text = extractText(response);
    const elapsed = Date.now() - start;

    process.stderr.write(
      `[bedrock] ${modelNote} — ${elapsed}ms — ${response.usage?.inputTokens ?? "?"} in / ${response.usage?.outputTokens ?? "?"} out\n`,
    );

    console.log(text);
    process.exit(0);
  } catch (err: unknown) {
    const elapsed = Date.now() - start;
    process.stderr.write(`[bedrock] ${modelNote} — failed after ${elapsed}ms\n`);

    if (err && typeof err === "object" && "stderr" in err) {
      const stderr = String((err as { stderr?: string }).stderr ?? "");
      if (stderr) process.stderr.write(stderr);
    }

    const message = err instanceof Error ? err.message : String(err);
    if (!String(err).includes("stderr")) {
      process.stderr.write(`${message}\n`);
    }

    process.stderr.write(`Try: aws sso login --profile ${profile}\n`);
    process.exit(1);
  }
}

main();
