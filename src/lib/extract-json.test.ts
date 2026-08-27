import { describe, it, expect } from "vitest";
import { extractJson } from "./extract-json.js";

describe("extractJson", () => {
  it("extracts JSON from a fenced code block", () => {
    const raw = '```json\n{"groups": []}\n```';
    expect(extractJson(raw)).toBe('{"groups": []}');
  });

  it("extracts JSON from an unclosed fence (truncated output)", () => {
    const raw = '```json\n{"groupKey": "Alice", "done": ["text"]';
    expect(extractJson(raw)).toBe('{"groupKey": "Alice", "done": ["text"]');
  });

  it("extracts JSON from bare text with preamble", () => {
    const raw = 'Here is the result:\n{"groups": []}';
    expect(extractJson(raw)).toBe('{"groups": []}');
  });

  it("returns trimmed text when already valid JSON", () => {
    expect(extractJson('  {"a": 1}  ')).toBe('{"a": 1}');
  });
});
