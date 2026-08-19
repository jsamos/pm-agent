/**
 * Generic agent loop: LLM + tools until the task is complete.
 * The LLM decides which tools to call and when it's done.
 */

import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutionContext } from "./context.js";
import type { Message } from "./llm.js";
import type { ToolRegistry } from "../tools/registry.js";

const TRACE_DIR = join(process.cwd(), "output", "traces");

function traceEnabled(): boolean {
  return process.env.AGENT_TRACE === "1";
}

let traceFile: string | null = null;

function initTrace(task: string): void {
  if (!traceEnabled()) return;
  mkdirSync(TRACE_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  traceFile = join(TRACE_DIR, `${ts}.ndjson`);
  trace("init", { task });
}

export function trace(event: string, data: Record<string, unknown>): void {
  if (!traceFile) return;
  const entry = { ts: Date.now(), event, ...data };
  appendFileSync(traceFile, JSON.stringify(entry) + "\n");
}

export interface AgentLoopOptions {
  systemPrompt: string;
  userMessage: string;
  registry: ToolRegistry;
  context: ExecutionContext;
  maxTurns?: number;
}

export interface ToolCallEntry {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface AgentLoopResult {
  response: string;
  turns: number;
  toolCalls: ToolCallEntry[];
  output: unknown;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { systemPrompt, userMessage, registry, context, maxTurns = 10 } = options;

  initTrace(userMessage);
  trace("system_prompt", { content: systemPrompt });

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const tools = registry.list().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as unknown as Record<string, unknown>,
  }));
  const toolCallLog: AgentLoopResult["toolCalls"] = [];
  let turns = 0;

  while (turns < maxTurns) {
    turns++;

    const llmStart = Date.now();
    const response = await context.llm.generateWithTools(
      messages as Array<{ role: "system" | "user" | "assistant"; content: string }>,
      tools,
    );
    const llmMs = Date.now() - llmStart;

    const toolNames = response.toolCalls?.map((tc) => tc.name) ?? [];
    process.stderr.write(`  [llm]  turn ${turns} — ${llmMs}ms${toolNames.length > 0 ? ` → ${toolNames.join(", ")}` : " → done"}\n`);
    trace("llm_response", {
      turn: turns,
      ms: llmMs,
      content: response.content,
      toolCalls: response.toolCalls?.map((tc) => ({ name: tc.name, args: tc.arguments })),
      finishReason: response.finishReason,
    });

    // If no tool calls, the agent is done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      const lastResult = toolCallLog.length > 0 ? toolCallLog[toolCallLog.length - 1].result : null;
      if (traceFile) process.stderr.write(`  [trace] ${traceFile}\n`);
      return { response: response.content || "", turns, toolCalls: toolCallLog, output: lastResult };
    }

    // Add assistant message with tool calls
    messages.push({
      role: "assistant",
      content: response.content || "",
      toolCalls: response.toolCalls,
    });

    // Execute each tool call and add results
    for (const tc of response.toolCalls) {
      const args = tc.arguments as Record<string, unknown>;

      // Expose the log so tools can read prior results
      context.toolCallLog = toolCallLog;

      const toolStart = Date.now();
      let result: unknown;
      try {
        result = await registry.call(tc.name, args, context);
      } catch (err) {
        result = { error: (err as Error).message };
      }
      const toolMs = Date.now() - toolStart;

      process.stderr.write(`  [tool] ${tc.name}(${JSON.stringify(args)}) — ${toolMs}ms\n`);
      trace("tool_call", { name: tc.name, args, ms: toolMs, resultSummary: (result as Record<string, unknown>)?.summary });

      toolCallLog.push({ tool: tc.name, args, result });

      // If the tool result includes a summary, send that to the LLM
      // instead of the full result (saves tokens on large responses).
      // Full result stays in toolCallLog for downstream pipeline use.
      const resultObj = result as Record<string, unknown> | null;
      const llmContent = resultObj && typeof resultObj.summary === "string"
        ? resultObj.summary
        : JSON.stringify(result);

      trace("tool_result_to_llm", { name: tc.name, content: llmContent.slice(0, 500) });

      messages.push({
        role: "tool",
        content: llmContent,
        toolCallId: tc.id,
      });
    }
  }

  const lastResult = toolCallLog.length > 0 ? toolCallLog[toolCallLog.length - 1].result : null;
  if (traceFile) process.stderr.write(`  [trace] ${traceFile}\n`);
  return { response: "Max turns reached without completion.", turns, toolCalls: toolCallLog, output: lastResult };
}
