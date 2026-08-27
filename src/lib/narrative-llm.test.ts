import { describe, it, expect } from "vitest";
import {
  parseGroupNarrativeResponse,
  parseEpicNarrativeResponse,
  SUBMIT_GROUP_NARRATIVE_TOOL,
  SUBMIT_EPIC_NARRATIVE_TOOL,
  countExpectedSections,
  isGroupNarrativeComplete,
} from "./narrative-llm.js";
import type { LLMResponse } from "./llm.js";

describe("parseGroupNarrativeResponse", () => {
  it("prefers submit_group_narrative tool call over text content", () => {
    const response: LLMResponse = {
      content: '{"groupKey": "wrong"}',
      toolCalls: [
        {
          id: "tool-1",
          name: SUBMIT_GROUP_NARRATIVE_TOOL.name,
          arguments: {
            groupKey: "Alice",
            inProgress: ['Shows "No insurance information on file" correctly.'],
          },
        },
      ],
      finishReason: "tool_calls",
    };

    const { parsed, source } = parseGroupNarrativeResponse(response, "fallback");
    expect(source).toBe("tool");
    expect(parsed.groupKey).toBe("Alice");
    expect(parsed.inProgress?.[0]).toContain('"No insurance information on file"');
  });

  it("falls back to JSON text when no tool call is present", () => {
    const response: LLMResponse = {
      content: '```json\n{"groupKey": "PROJ-1", "delivered": ["Done."]}\n```',
      toolCalls: [],
      finishReason: "stop",
    };

    const { parsed, source } = parseGroupNarrativeResponse(response, "fallback");
    expect(source).toBe("json");
    expect(parsed.groupKey).toBe("PROJ-1");
    expect(parsed.delivered).toEqual(["Done."]);
  });

  it("returns empty fallback when tool and JSON both fail", () => {
    const response: LLMResponse = {
      content: "not json",
      toolCalls: [],
      finishReason: "stop",
    };

    const { parsed, source } = parseGroupNarrativeResponse(response, "Alice");
    expect(source).toBe("fallback");
    expect(parsed).toEqual({ groupKey: "Alice" });
  });
});

describe("countExpectedSections", () => {
  it("counts status sections from the user message", () => {
    const msg = [
      "Write prose for Alice.",
      "  Done (2):",
      "  - A-1 ...",
      "  In Progress (1):",
      "  - A-2 ...",
    ].join("\n");
    expect(countExpectedSections(msg)).toEqual({
      delivered: 2,
      inProgress: 1,
      notStarted: 0,
    });
  });
});

describe("isGroupNarrativeComplete", () => {
  it("requires prose for every non-empty status section", () => {
    expect(isGroupNarrativeComplete(
      { groupKey: "Alice", delivered: ["Done."], inProgress: [] },
      { delivered: 1, inProgress: 1, notStarted: 0 },
    )).toBe(false);

    expect(isGroupNarrativeComplete(
      { groupKey: "Alice", delivered: ["Done."], inProgress: ["Building."] },
      { delivered: 1, inProgress: 1, notStarted: 0 },
    )).toBe(true);
  });
});

describe("parseEpicNarrativeResponse", () => {
  it("parses quoted prose from tool call", () => {
    const response: LLMResponse = {
      content: null,
      toolCalls: [
        {
          id: "tool-1",
          name: SUBMIT_EPIC_NARRATIVE_TOOL.name,
          arguments: {
            sectionType: "outcome",
            section: 'Users see "Unsupported Payer ID" instead of a generic error.',
            done: ["Shipped the first slice."],
          },
        },
      ],
      finishReason: "tool_calls",
    };

    const { parsed, source } = parseEpicNarrativeResponse(response);
    expect(source).toBe("tool");
    expect(parsed.section).toContain('"Unsupported Payer ID"');
    expect(parsed.done).toEqual(["Shipped the first slice."]);
  });
});
