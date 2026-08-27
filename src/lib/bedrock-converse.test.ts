import { describe, it, expect } from "vitest";
import { parseConverseResponse } from "./bedrock-converse.js";

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
