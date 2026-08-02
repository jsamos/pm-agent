/**
 * Unified PM Agent
 * One agent with all tools — interprets user requests and calls the right tools.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop, type AgentLoopResult } from "../lib/agent-loop.js";
import type { ExecutionContext } from "../lib/context.js";
import type { ToolRegistry } from "../tools/registry.js";
import { createRegistry } from "./registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_PROMPT = readFileSync(resolve(__dirname, "../prompts/orchestrator.md"), "utf-8").trim();

function buildSystemPrompt(registry: ToolRegistry): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return [
    ORCHESTRATOR_PROMPT,
    `Current time: ${timestamp}`,
    `Available tools:\n\n${registry.toCatalog()}`,
  ].join("\n\n");
}

export async function runAgent(task: string, context: ExecutionContext): Promise<AgentLoopResult> {
  const registry = createRegistry();

  return runAgentLoop({
    systemPrompt: buildSystemPrompt(registry),
    userMessage: task,
    registry,
    context,
    maxTurns: 10,
  });
}
