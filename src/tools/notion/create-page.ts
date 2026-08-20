/**
 * Tool: create_notion_page
 * Create a new Notion page under a parent page.
 * Wraps the notion-create-pages MCP tool.
 */

import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import { resolveContentRef } from "../../lib/context.js";
import { callNotionTool, extractTextContent } from "./client.js";
import { parseNotionId } from "./parse-url.js";
import { trace } from "../../lib/agent-loop.js";

export interface CreatePageResult {
  pageId: string;
  url: string;
}

export function parseCreateResponse(raw: string): CreatePageResult {
  const urlMatch = raw.match(/https:\/\/(?:www\.)?notion\.so\/\S+/);
  const url = urlMatch ? urlMatch[0] : "";

  const idMatch = raw.match(/(?:Page ID|page_id|id):\s*([0-9a-f-]+)/i);
  const pageId = idMatch ? idMatch[1].replace(/-/g, "") : "";

  return { pageId, url };
}

export const createNotionPageTool: Tool = {
  name: "create_notion_page",
  description:
    "Create a new Notion page under a parent page. Use contentFrom to forward the full output of a prior tool (e.g. generate_sprint_narrative) as the page body.",
  parameters: {
    type: "object",
    properties: {
      parentPageUrl: {
        type: "string",
        description: "Notion URL or page ID of the parent page.",
      },
      title: {
        type: "string",
        description: "Title of the new page.",
      },
      content: {
        type: "string",
        description: "Markdown content for the page body.",
      },
      contentFrom: {
        type: "string",
        description:
          "Tool name to pull full content from (e.g. 'generate_sprint_narrative'). Overrides content.",
      },
    },
    required: ["parentPageUrl", "title"],
  },

  async execute(args, context: ExecutionContext) {
    const parentPageUrl = args.parentPageUrl as string;
    const title = args.title as string;
    const contentFrom = args.contentFrom as string | undefined;
    const rawContent = args.content as string | undefined;

    if (!parentPageUrl) throw new Error("parentPageUrl is required");
    if (!title) throw new Error("title is required");

    let body: string | undefined;
    if (contentFrom) {
      const resolved = resolveContentRef(context.toolCallLog, contentFrom);
      if (!resolved) {
        throw new Error(
          `contentFrom "${contentFrom}" not found in tool call log. ` +
          `Make sure ${contentFrom} was called earlier in this conversation.`
        );
      }
      body = resolved;
    } else {
      body = rawContent;
    }

    const parentId = parseNotionId(parentPageUrl);

    const params: Record<string, unknown> = {
      parent: { page_id: parentId },
      pages: [
        {
          properties: { title },
          ...(body ? { content: body } : {}),
        },
      ],
    };

    const result = await callNotionTool("notion-create-pages", params);
    const text = extractTextContent(result);

    trace("notion_mcp_response", {
      tool: "create_notion_page",
      raw: text.slice(0, 1000),
    });

    const parsed = parseCreateResponse(text);

    const refNote = contentFrom ? ` (content from ${contentFrom})` : "";
    const linkNote = parsed.url ? ` — ${parsed.url}` : "";
    const summary = `Created page "${title}" under parent${refNote}${linkNote}`;
    return { ...parsed, summary };
  },
};
