/**
 * Tool: update_notion_page
 * Update an existing Notion page's content via full replace.
 */

import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import { resolveContentRef } from "../../lib/context.js";
import { callNotionTool, extractTextContent } from "./client.js";
import { parseNotionId } from "./parse-url.js";
import { trace } from "../../lib/agent-loop.js";

export const updateNotionPageTool: Tool = {
  name: "update_notion_page",
  description:
    "Update an existing Notion page's content. Replaces the full page body. Use contentFrom to forward the full output of a prior tool (e.g. generate_sprint_narrative). Optionally update the page title.",
  parameters: {
    type: "object",
    properties: {
      pageUrl: {
        type: "string",
        description: "Notion URL or page ID of the page to update.",
      },
      content: {
        type: "string",
        description: "New markdown content to replace the page body with.",
      },
      contentFrom: {
        type: "string",
        description:
          "Tool name to pull full content from (e.g. 'generate_sprint_narrative'). Overrides content.",
      },
      title: {
        type: "string",
        description: "New title for the page (optional). If omitted, the title is unchanged.",
      },
    },
    required: ["pageUrl"],
  },

  async execute(args, context: ExecutionContext) {
    const pageUrl = args.pageUrl as string;
    const contentFrom = args.contentFrom as string | undefined;
    const rawContent = args.content as string | undefined;
    const title = args.title as string | undefined;

    if (!pageUrl) throw new Error("pageUrl is required");

    const pageId = parseNotionId(pageUrl);

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

    if (body) {
      const replaceResult = await callNotionTool("notion-update-page", {
        page_id: pageId,
        command: "replace_content",
        new_str: body,
      });
      const replaceText = extractTextContent(replaceResult);
      trace("notion_mcp_response", {
        tool: "update_notion_page",
        command: "replace_content",
        raw: replaceText.slice(0, 1000),
      });
    } else if (!title) {
      throw new Error("At least one of content, contentFrom, or title must be provided");
    }

    if (title) {
      const propsResult = await callNotionTool("notion-update-page", {
        page_id: pageId,
        command: "update_properties",
        properties: { title },
      });
      const propsText = extractTextContent(propsResult);
      trace("notion_mcp_response", {
        tool: "update_notion_page",
        command: "update_properties",
        raw: propsText.slice(0, 1000),
      });
    }

    const refNote = contentFrom ? ` (content from ${contentFrom})` : "";
    const titleNote = title ? `, title → "${title}"` : "";
    const summary = `Updated page ${pageId}${refNote}${titleNote}`;
    return { pageId, summary };
  },
};
