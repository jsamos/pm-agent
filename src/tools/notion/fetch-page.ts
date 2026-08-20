/**
 * Tool: fetch_notion_page
 * Fetch a Notion page's content as markdown.
 * Wraps the notion-fetch MCP tool.
 */

import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import { callNotionTool, extractTextContent } from "./client.js";
import { trace } from "../../lib/agent-loop.js";

export interface FetchPageResult {
  title: string;
  content: string;
  pageId: string;
  url: string;
}

export function parseFetchResponse(raw: string): FetchPageResult {
  const titleMatch = raw.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "Untitled";

  const pageIdMatch = raw.match(/Page ID:\s*([0-9a-f-]+)/i);
  const pageId = pageIdMatch ? pageIdMatch[1].replace(/-/g, "") : "";

  const urlMatch = raw.match(/URL:\s*(https:\/\/\S+)/i);
  const url = urlMatch ? urlMatch[1] : "";

  return { title, content: raw, pageId, url };
}

export const fetchNotionPageTool: Tool = {
  name: "fetch_notion_page",
  description:
    "Fetch a Notion page by URL or ID. Returns the page title and content as markdown.",
  parameters: {
    type: "object",
    properties: {
      pageUrl: {
        type: "string",
        description: "Notion page URL or page ID.",
      },
    },
    required: ["pageUrl"],
  },

  async execute(args, _context: ExecutionContext) {
    const pageUrl = args.pageUrl as string;
    if (!pageUrl) throw new Error("pageUrl is required");

    const result = await callNotionTool("notion-fetch", { id: pageUrl });
    const text = extractTextContent(result);

    trace("notion_mcp_response", {
      tool: "fetch_notion_page",
      raw: text.slice(0, 1000),
    });

    const parsed = parseFetchResponse(text);

    const summary = `Fetched page "${parsed.title}" (${parsed.content.length} chars).`;
    return { ...parsed, summary };
  },
};
