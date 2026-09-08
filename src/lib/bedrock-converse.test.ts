import { describe, it, expect } from "vitest";
import { parseConverseResponse, converseMessagesForTest } from "./bedrock-converse.js";
import type { Message } from "./llm.js";

describe("parseConverseResponse", () => {
  it("extracts text from a Converse response", () => {
    const parsed = parseConverseResponse({
      output: { message: { content: [{ text: "Hello" }] } },
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    expect(parsed.content).toBe("Hello");
    expect(parsed.finishReason).toBe("stop");
    expect(parsed.usage?.totalTokens).toBe(15);
  });

  it("extracts tool calls from a Converse response", () => {
    const parsed = parseConverseResponse({
      output: {
        message: {
          content: [
            {
              toolUse: {
                toolUseId: "tool-1",
                name: "search_issues",
                input: { jql: "project = PROJ" },
              },
            },
          ],
        },
      },
      stopReason: "tool_use",
    });

    expect(parsed.toolCalls).toEqual([
      {
        id: "tool-1",
        name: "search_issues",
        arguments: { jql: "project = PROJ" },
      },
    ]);
    expect(parsed.finishReason).toBe("tool_calls");
  });
});

describe("converseMessagesForTest", () => {
  it("batches consecutive tool results into one user message", () => {
    const messages: Message[] = [
      { role: "user", content: "do the thing" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "tool-a", name: "first_tool", arguments: {} },
          { id: "tool-b", name: "second_tool", arguments: {} },
        ],
      },
      { role: "tool", content: '{"ok":1}', toolCallId: "tool-a" },
      { role: "tool", content: '{"ok":2}', toolCallId: "tool-b" },
    ];

    const converted = converseMessagesForTest(messages) as Array<{
      role: string;
      content: Array<{ toolResult?: { toolUseId: string } }>;
    }>;

    expect(converted).toHaveLength(3);
    const toolResultMessage = converted[2];
    expect(toolResultMessage.role).toBe("user");
    expect(toolResultMessage.content).toHaveLength(2);
    expect(toolResultMessage.content[0].toolResult?.toolUseId).toBe("tool-a");
    expect(toolResultMessage.content[1].toolResult?.toolUseId).toBe("tool-b");
  });
});
