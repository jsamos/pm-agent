import { describe, it, expect } from "vitest";
import { parseNotionId } from "./parse-url.js";
import { parseFetchResponse } from "./fetch-page.js";
import { parseCreateResponse } from "./create-page.js";

describe("parseNotionId", () => {
  it("extracts ID from standard notion.so URL", () => {
    const url = "https://www.notion.so/myworkspace/Sprint-Report-a1b2c3d4e5f67890abcdef1234567890";
    expect(parseNotionId(url)).toBe("a1b2c3d4e5f67890abcdef1234567890");
  });

  it("extracts ID from notion.site URL", () => {
    const url = "https://myspace.notion.site/Page-Title-a1b2c3d4e5f67890abcdef1234567890";
    expect(parseNotionId(url)).toBe("a1b2c3d4e5f67890abcdef1234567890");
  });

  it("extracts ID from URL with query params", () => {
    const url = "https://www.notion.so/workspace/Page-a1b2c3d4e5f67890abcdef1234567890?v=abc123";
    expect(parseNotionId(url)).toBe("a1b2c3d4e5f67890abcdef1234567890");
  });

  it("extracts ID from bare notion.so path", () => {
    const url = "https://www.notion.so/a1b2c3d4e5f67890abcdef1234567890";
    expect(parseNotionId(url)).toBe("a1b2c3d4e5f67890abcdef1234567890");
  });

  it("passes through raw 32-char hex ID", () => {
    expect(parseNotionId("a1b2c3d4e5f67890abcdef1234567890")).toBe("a1b2c3d4e5f67890abcdef1234567890");
  });

  it("strips dashes from UUID format", () => {
    expect(parseNotionId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe("a1b2c3d4e5f67890abcdef1234567890");
  });

  it("throws on invalid input", () => {
    expect(() => parseNotionId("not-a-valid-id")).toThrow("Could not extract Notion page ID");
  });

  it("throws on empty string", () => {
    expect(() => parseNotionId("")).toThrow("Could not extract Notion page ID");
  });

  it("handles trailing slashes", () => {
    const url = "https://www.notion.so/workspace/Page-a1b2c3d4e5f67890abcdef1234567890/";
    expect(parseNotionId(url)).toBe("a1b2c3d4e5f67890abcdef1234567890");
  });
});

describe("parseFetchResponse", () => {
  it("extracts title from markdown heading", () => {
    const raw = "# Sprint Report\n\nSome content here.";
    const result = parseFetchResponse(raw);
    expect(result.title).toBe("Sprint Report");
    expect(result.content).toBe(raw);
  });

  it("returns Untitled when no heading found", () => {
    const raw = "Some content without a heading.";
    const result = parseFetchResponse(raw);
    expect(result.title).toBe("Untitled");
  });

  it("extracts page ID from metadata", () => {
    const raw = "# Test\n\nPage ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890\n\nContent.";
    const result = parseFetchResponse(raw);
    expect(result.pageId).toBe("a1b2c3d4e5f67890abcdef1234567890");
  });

  it("extracts URL from metadata", () => {
    const raw = "# Test\n\nURL: https://www.notion.so/workspace/Test-abc123\n\nContent.";
    const result = parseFetchResponse(raw);
    expect(result.url).toBe("https://www.notion.so/workspace/Test-abc123");
  });
});

describe("parseCreateResponse", () => {
  it("extracts URL from response text", () => {
    const raw = "Created page. URL: https://www.notion.so/workspace/New-Page-abc123def456";
    const result = parseCreateResponse(raw);
    expect(result.url).toBe("https://www.notion.so/workspace/New-Page-abc123def456");
  });

  it("extracts page ID from response text", () => {
    const raw = "Page ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const result = parseCreateResponse(raw);
    expect(result.pageId).toBe("a1b2c3d4e5f67890abcdef1234567890");
  });

  it("returns empty strings when no metadata found", () => {
    const raw = "Page created successfully.";
    const result = parseCreateResponse(raw);
    expect(result.pageId).toBe("");
    expect(result.url).toBe("");
  });
});
