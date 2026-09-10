/**
 * Tool: fetch_notion_transcript
 * Fetch a Notion meeting transcript page with include_transcript: true
 * and return the raw spoken transcript text.
 */

import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import { callNotionTool, extractTextContent } from "./client.js";
import { extractTranscriptText, extractMeetingTitle, extractPageUrl } from "../../lib/notion-transcript.js";
import { trace } from "../../lib/agent-loop.js";

export interface FetchTranscriptResult {
  title: string;
  transcript: string;
  pageId: string;
  url: string;
  charCount: number;
  summary: string;
}

export const fetchNotionTranscriptTool: Tool = {
  name: "fetch_notion_transcript",
  description:
    "Fetch a meeting transcript from a Notion page. Passes include_transcript: true to the Notion MCP to retrieve the raw spoken text from the <transcript> block. Returns the title and transcript body. Use for meeting-ppoa when the user links a Notion transcript page.",
  parameters: {
    type: "object",
    properties: {
      pageUrl: {
        type: "string",
        description: "Notion page URL or page ID of the meeting transcript page.",
      },
    },
    required: ["pageUrl"],
  },

  async execute(args, _context: ExecutionContext): Promise<FetchTranscriptResult> {
    const pageUrl = args.pageUrl as string;
    if (!pageUrl?.trim()) throw new Error("pageUrl is required");

    const result = await callNotionTool("notion-fetch", {
      id: pageUrl.trim(),
      include_transcript: true,
    });
    const text = extractTextContent(result);

    trace("notion_mcp_response", {
      tool: "fetch_notion_transcript",
      raw: text.slice(0, 1000),
    });

    const transcript = extractTranscriptText(text);
    if (!transcript) {
      throw new Error(
        "No transcript found. The page may not be a meeting note, or the transcript was not recorded.",
      );
    }

    const title = extractMeetingTitle(text) ?? "Untitled Meeting";
    const url = extractPageUrl(text) ?? pageUrl.trim();
    const pageIdMatch = text.match(/Page ID:\s*([0-9a-f-]+)/i);
    const pageId = pageIdMatch ? pageIdMatch[1].replace(/-/g, "") : "";

    return {
      title,
      transcript,
      pageId,
      url,
      charCount: transcript.length,
      summary: `Fetched transcript "${title}" (${transcript.length} chars).`,
    };
  },
};
