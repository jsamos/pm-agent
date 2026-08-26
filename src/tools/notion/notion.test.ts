import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseNotionId } from "./parse-url.js";
import { parseFetchResponse, fetchNotionPageTool } from "./fetch-page.js";
import { parseCreateResponse, createNotionPageTool } from "./create-page.js";
import { updateNotionPageTool } from "./update-page.js";

vi.mock("./client.js", () => ({
  callNotionTool: vi.fn(async () => ({
    content: [{ type: "text", text: "OK" }],
    isError: false,
  })),
  extractTextContent: vi.fn((result: { content: { text: string }[] }) => result.content[0].text),
}));

vi.mock("../../lib/agent-loop.js", () => ({
  trace: vi.fn(),
}));

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

// --- update_notion_page mode tests ---

describe("updateNotionPageTool.execute", () => {
  let mockCallNotionTool: ReturnType<typeof vi.fn>;
  let mockExtractTextContent: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const client = await import("./client.js");
    mockCallNotionTool = client.callNotionTool as ReturnType<typeof vi.fn>;
    mockExtractTextContent = client.extractTextContent as ReturnType<typeof vi.fn>;
    mockCallNotionTool.mockClear();
    mockCallNotionTool.mockResolvedValue({
      content: [{ type: "text", text: "OK" }],
      isError: false,
    });
    mockExtractTextContent.mockImplementation(
      (result: { content: { text: string }[] }) => result.content[0].text,
    );
  });

  const PAGE_ID = "a1b2c3d4e5f67890abcdef1234567890";
  const PAGE_URL = `https://www.notion.so/workspace/Page-${PAGE_ID}`;

  // [tested] Scenario: Full replace mode (default)
  it("calls replace_content when mode is 'replace'", async () => {
    const context = {
      toolCallLog: [],
      config: {},
    };

    await updateNotionPageTool.execute!(
      { pageUrl: PAGE_URL, content: "# New Content" },
      context as any,
    );

    expect(mockCallNotionTool).toHaveBeenCalledWith("notion-update-page", {
      page_id: PAGE_ID,
      command: "replace_content",
      new_str: "# New Content",
    });
  });

  // [tested] Scenario: Update with content from prior tool
  it("uses contentFrom to replace page body", async () => {
    const narrative = "# Sprint Report\n\nFull narrative markdown.";
    const context = {
      toolCallLog: [
        {
          tool: "generate_sprint_narrative",
          args: {},
          result: { narrative, summary: "done" },
        },
      ],
      config: {},
    };

    await updateNotionPageTool.execute!(
      { pageUrl: PAGE_URL, contentFrom: "generate_sprint_narrative" },
      context as any,
    );

    expect(mockCallNotionTool).toHaveBeenCalledWith("notion-update-page", {
      page_id: PAGE_ID,
      command: "replace_content",
      new_str: narrative,
    });
  });
});

describe("fetchNotionPageTool.execute", () => {
  let mockCallNotionTool: ReturnType<typeof vi.fn>;
  let mockExtractTextContent: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const client = await import("./client.js");
    mockCallNotionTool = client.callNotionTool as ReturnType<typeof vi.fn>;
    mockExtractTextContent = client.extractTextContent as ReturnType<typeof vi.fn>;
    mockCallNotionTool.mockClear();
    mockExtractTextContent.mockImplementation(
      (result: { content: { text: string }[] }) => result.content[0].text,
    );
  });

  const PAGE_ID = "a1b2c3d4e5f67890abcdef1234567890";
  const PAGE_URL = `https://www.notion.so/workspace/Sprint-${PAGE_ID}`;
  const FETCH_BODY = `# Sprint Report\n\nPage ID: ${PAGE_ID}\n\nContent here.`;

  // [tested] Scenario: Fetch by URL
  it("returns title and markdown content for a page URL", async () => {
    mockCallNotionTool.mockResolvedValue({
      content: [{ type: "text", text: FETCH_BODY }],
      isError: false,
    });

    const result = await fetchNotionPageTool.execute!(
      { pageUrl: PAGE_URL },
      { toolCallLog: [], config: {} } as any,
    );

    expect(mockCallNotionTool).toHaveBeenCalledWith("notion-fetch", { id: PAGE_URL });
    expect((result as any).title).toBe("Sprint Report");
    expect((result as any).content).toBe(FETCH_BODY);
  });

  // [tested] Scenario: Fetch by page ID
  it("accepts a raw page ID", async () => {
    mockCallNotionTool.mockResolvedValue({
      content: [{ type: "text", text: FETCH_BODY }],
      isError: false,
    });

    const result = await fetchNotionPageTool.execute!(
      { pageUrl: PAGE_ID },
      { toolCallLog: [], config: {} } as any,
    );

    expect(mockCallNotionTool).toHaveBeenCalledWith("notion-fetch", { id: PAGE_ID });
    expect((result as any).title).toBe("Sprint Report");
  });

  // [tested] Scenario: Invalid page
  it("raises when the MCP call fails", async () => {
    mockCallNotionTool.mockRejectedValue(new Error("Notion MCP error (notion-fetch): page not found"));

    await expect(
      fetchNotionPageTool.execute!(
        { pageUrl: PAGE_URL },
        { toolCallLog: [], config: {} } as any,
      ),
    ).rejects.toThrow("page not found");
  });
});

describe("createNotionPageTool.execute", () => {
  let mockCallNotionTool: ReturnType<typeof vi.fn>;
  let mockExtractTextContent: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const client = await import("./client.js");
    mockCallNotionTool = client.callNotionTool as ReturnType<typeof vi.fn>;
    mockExtractTextContent = client.extractTextContent as ReturnType<typeof vi.fn>;
    mockCallNotionTool.mockClear();
    mockCallNotionTool.mockResolvedValue({
      content: [{
        type: "text",
        text: "Created page. URL: https://www.notion.so/workspace/New-Page-abc123def456",
      }],
      isError: false,
    });
    mockExtractTextContent.mockImplementation(
      (result: { content: { text: string }[] }) => result.content[0].text,
    );
  });

  const PARENT_ID = "a1b2c3d4e5f67890abcdef1234567890";
  const PARENT_URL = `https://www.notion.so/workspace/Parent-${PARENT_ID}`;

  // [tested] Scenario: Create with markdown content
  it("creates a page with title and body content", async () => {
    const result = await createNotionPageTool.execute!(
      {
        parentPageUrl: PARENT_URL,
        title: "Sprint Report",
        content: "# Sprint Report\n\nBody text.",
      },
      { toolCallLog: [], config: {} } as any,
    );

    expect(mockCallNotionTool).toHaveBeenCalledWith("notion-create-pages", {
      parent: { page_id: PARENT_ID },
      pages: [{ properties: { title: "Sprint Report" }, content: "# Sprint Report\n\nBody text." }],
    });
    expect((result as any).url).toContain("notion.so");
  });

  // [tested] Scenario: Create with content from prior tool
  it("uses contentFrom as page body", async () => {
    const narrative = "# Sprint Report\n\nGenerated narrative.";
    await createNotionPageTool.execute!(
      {
        parentPageUrl: PARENT_URL,
        title: "Sprint Report",
        contentFrom: "generate_sprint_narrative",
      },
      {
        toolCallLog: [
          {
            tool: "generate_sprint_narrative",
            args: {},
            result: { narrative, summary: "done" },
          },
        ],
        config: {},
      } as any,
    );

    expect(mockCallNotionTool).toHaveBeenCalledWith("notion-create-pages", {
      parent: { page_id: PARENT_ID },
      pages: [{ properties: { title: "Sprint Report" }, content: narrative }],
    });
  });

  // [tested] Scenario: Missing parent
  it("raises when parent URL is invalid", async () => {
    await expect(
      createNotionPageTool.execute!(
        { parentPageUrl: "not-a-valid-id", title: "Sprint Report" },
        { toolCallLog: [], config: {} } as any,
      ),
    ).rejects.toThrow("Could not extract Notion page ID");
  });
});
