import { describe, it, expect } from "vitest";
import {
  parseNarrativeResponse,
  SUBMIT_NARRATIVE_TOOL,
  isNarrativeComplete,
} from "./narrative-llm.js";
import type { LLMResponse } from "./llm.js";

describe("parseNarrativeResponse", () => {
  it("prefers submit_narrative tool call over text content", () => {
    const response: LLMResponse = {
      content: '{"groupKey": "wrong"}',
      toolCalls: [
        {
          id: "tool-1",
          name: SUBMIT_NARRATIVE_TOOL.name,
          arguments: {
            groupKey: "Alice",
            inProgress: ['Shows "No insurance information on file" correctly.'],
          },
        },
      ],
      finishReason: "tool_calls",
    };

    const { parsed, source } = parseNarrativeResponse(response, "fallback");
    expect(source).toBe("tool");
    expect(parsed.groupKey).toBe("Alice");
    expect(parsed.inProgress?.[0]).toContain('"No insurance information on file"');
  });

  it("accepts legacy submit_group_narrative tool name", () => {
    const response: LLMResponse = {
      content: null,
      toolCalls: [
        {
          id: "tool-1",
          name: "submit_group_narrative",
          arguments: { groupKey: "Alice", done: ["Shipped."] },
        },
      ],
      finishReason: "tool_calls",
    };

    const { parsed, source } = parseNarrativeResponse(response, "fallback");
    expect(source).toBe("tool");
    expect(parsed.done).toEqual(["Shipped."]);
  });

  it("falls back to JSON text when no tool call is present", () => {
    const response: LLMResponse = {
      content: '```json\n{"groupKey": "PROJ-1", "done": ["Done."]}\n```',
      toolCalls: [],
      finishReason: "stop",
    };

    const { parsed, source } = parseNarrativeResponse(response, "fallback");
    expect(source).toBe("json");
    expect(parsed.groupKey).toBe("PROJ-1");
    expect(parsed.done).toEqual(["Done."]);
  });

  it("returns empty fallback when tool and JSON both fail", () => {
    const response: LLMResponse = {
      content: "not json",
      toolCalls: [],
      finishReason: "stop",
    };

    const { parsed, source } = parseNarrativeResponse(response, "Alice");
    expect(source).toBe("fallback");
    expect(parsed).toEqual({ groupKey: "Alice" });
  });
});

describe("isNarrativeComplete", () => {
  it("requires prose for every non-empty status section", () => {
    expect(isNarrativeComplete(
      { groupKey: "Alice", done: ["Done."], inProgress: [] },
      { done: 1, inProgress: 1, notStarted: 0 },
    )).toBe(false);

    expect(isNarrativeComplete(
      { groupKey: "Alice", done: ["Done."], inProgress: ["Building."] },
      { done: 1, inProgress: 1, notStarted: 0 },
    )).toBe(true);
  });
});
