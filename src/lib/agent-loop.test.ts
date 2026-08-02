import { describe, it, expect } from "vitest";
import { runAgentLoop } from "./agent-loop.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ExecutionContext } from "./context.js";
import type { LLM } from "./llm.js";

function createMockLLM(responses: Array<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }>): LLM {
  let callIndex = 0;
  return {
    generate: async () => ({ content: "", finishReason: "stop", toolCalls: [] }),
    generateWithTools: async () => {
      const resp = responses[callIndex++];
      return {
        content: resp.content,
        finishReason: resp.toolCalls?.length ? "tool_calls" : "stop",
        toolCalls: resp.toolCalls || [],
      };
    },
  };
}

function createMockContext(llm: LLM): ExecutionContext {
  return {
    callTool: async () => ({}),
    listTools: async () => [],
    llm,
    config: {},
    meta: { attempt: 1, workflowName: "test", stepName: "test" },
    runAgentLoop: async () => "",
  };
}

describe("agent loop", () => {
  it("returns immediately when LLM responds without tool calls", async () => {
    const llm = createMockLLM([{ content: "Hello!" }]);
    const context = createMockContext(llm);
    const registry = new ToolRegistry();

    const result = await runAgentLoop({
      systemPrompt: "You are helpful.",
      userMessage: "Hi",
      registry,
      context,
    });

    expect(result.response).toBe("Hello!");
    expect(result.turns).toBe(1);
    expect(result.toolCalls).toEqual([]);
    expect(result.output).toBeNull();
  });

  it("executes tool calls and sends results back", async () => {
    const llm = createMockLLM([
      { content: "", toolCalls: [{ id: "tc1", name: "greet", arguments: { name: "world" } }] },
      { content: "Done!" },
    ]);
    const context = createMockContext(llm);
    const registry = new ToolRegistry();
    registry.register({
      name: "greet",
      description: "Greets someone",
      parameters: { type: "object", properties: { name: { type: "string" } } },
      execute: async (args) => ({ greeting: `Hello ${(args as { name: string }).name}` }),
    });

    const result = await runAgentLoop({
      systemPrompt: "You are helpful.",
      userMessage: "Greet the world",
      registry,
      context,
    });

    expect(result.response).toBe("Done!");
    expect(result.turns).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].result).toEqual({ greeting: "Hello world" });
    expect(result.output).toEqual({ greeting: "Hello world" });
  });

  it("sends summary to LLM when tool result has summary field", async () => {
    const messagesReceived: unknown[] = [];
    const llm: LLM = {
      generate: async () => ({ content: "", finishReason: "stop", toolCalls: [] }),
      generateWithTools: async (messages) => {
        messagesReceived.push([...messages]);
        if (messagesReceived.length === 1) {
          return {
            content: "",
            finishReason: "tool_calls",
            toolCalls: [{ id: "tc1", name: "big_tool", arguments: {} }],
          };
        }
        return { content: "Got it.", finishReason: "stop", toolCalls: [] };
      },
    };
    const context = createMockContext(llm);
    const registry = new ToolRegistry();
    registry.register({
      name: "big_tool",
      description: "Returns large data with summary",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ data: Array(100).fill("x"), summary: "100 items found." }),
    });

    const result = await runAgentLoop({
      systemPrompt: "test",
      userMessage: "go",
      registry,
      context,
    });

    // The LLM should have received the summary, not the full data
    const secondCall = messagesReceived[1] as Array<{ role: string; content: string }>;
    const toolMessage = secondCall.find((m) => m.role === "tool");
    expect(toolMessage?.content).toBe("100 items found.");

    // But the full result is in toolCalls
    expect((result.toolCalls[0].result as { data: string[] }).data).toHaveLength(100);
  });

  it("exposes toolCallLog on context for downstream tools", async () => {
    let capturedLog: unknown = null;
    const llm = createMockLLM([
      { content: "", toolCalls: [{ id: "tc1", name: "first", arguments: {} }] },
      { content: "", toolCalls: [{ id: "tc2", name: "second", arguments: {} }] },
      { content: "Done" },
    ]);
    const context = createMockContext(llm);
    const registry = new ToolRegistry();
    registry.register({
      name: "first",
      description: "First tool",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ value: 42 }),
    });
    registry.register({
      name: "second",
      description: "Reads prior results",
      parameters: { type: "object", properties: {} },
      execute: async (_args, ctx) => {
        capturedLog = [...(ctx.toolCallLog || [])];
        return { read: true };
      },
    });

    await runAgentLoop({
      systemPrompt: "test",
      userMessage: "go",
      registry,
      context,
    });

    // second tool should have seen first tool's result in the log
    const log = capturedLog as Array<{ tool: string; result: unknown }>;
    expect(log).toHaveLength(1);
    expect(log[0].tool).toBe("first");
    expect(log[0].result).toEqual({ value: 42 });
  });

  it("handles tool execution errors gracefully", async () => {
    const llm = createMockLLM([
      { content: "", toolCalls: [{ id: "tc1", name: "broken", arguments: {} }] },
      { content: "I see the error." },
    ]);
    const context = createMockContext(llm);
    const registry = new ToolRegistry();
    registry.register({
      name: "broken",
      description: "Always fails",
      parameters: { type: "object", properties: {} },
      execute: async () => { throw new Error("Something went wrong"); },
    });

    const result = await runAgentLoop({
      systemPrompt: "test",
      userMessage: "go",
      registry,
      context,
    });

    expect(result.toolCalls[0].result).toEqual({ error: "Something went wrong" });
    expect(result.response).toBe("I see the error.");
  });

  it("stops at maxTurns", async () => {
    // LLM always calls a tool, never finishes
    const llm: LLM = {
      generate: async () => ({ content: "", finishReason: "stop", toolCalls: [] }),
      generateWithTools: async () => ({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{ id: "tc", name: "loop", arguments: {} }],
      }),
    };
    const context = createMockContext(llm);
    const registry = new ToolRegistry();
    registry.register({
      name: "loop",
      description: "Loops forever",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    });

    const result = await runAgentLoop({
      systemPrompt: "test",
      userMessage: "go",
      registry,
      context,
      maxTurns: 3,
    });

    expect(result.turns).toBe(3);
    expect(result.response).toBe("Max turns reached without completion.");
  });
});
