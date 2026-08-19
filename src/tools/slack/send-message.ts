/**
 * Tool: send_slack_message
 * Send a message to a Slack channel or user.
 * Wraps the slack_send_message MCP tool.
 */

import type { Tool } from "../registry.js";
import type { ExecutionContext } from "../../lib/context.js";
import { resolveContentRef } from "../../lib/context.js";
import { callSlackTool, extractTextContent } from "./client.js";

export interface SendMessageResult {
  ok: boolean;
  messageLink: string | null;
  channelId: string;
  timestamp: string | null;
}

/**
 * The Slack MCP may return a markdown-formatted wrapper ({ results: string })
 * or structured JSON fields. We check for error indicators in either case
 * and throw so the LLM sees the failure.
 */
export function parseSendResult(raw: unknown): SendMessageResult {
  if (typeof raw === "string") {
    if (raw.toLowerCase().includes("error")) {
      throw new Error(`Slack send failed: ${raw.slice(0, 300)}`);
    }
    const linkMatch = raw.match(/https:\/\/\S*slack\.com\S*/);
    return { ok: true, messageLink: linkMatch?.[0] ?? null, channelId: "", timestamp: null };
  }

  const data = raw as Record<string, unknown>;

  if (typeof data.results === "string") {
    const text = data.results;
    if (text.toLowerCase().includes("error")) {
      throw new Error(`Slack send failed: ${text.slice(0, 300)}`);
    }
    const linkMatch = text.match(/https:\/\/\S*slack\.com\S*/);
    return { ok: true, messageLink: linkMatch?.[0] ?? null, channelId: "", timestamp: null };
  }

  if (data.ok === false) {
    throw new Error(`Slack send failed: ${(data.error as string) || JSON.stringify(data)}`);
  }

  return {
    ok: true,
    messageLink: (data.message_link as string) || (data.permalink as string) || null,
    channelId: (data.channel as string) || "",
    timestamp: (data.ts as string) || (data.message_ts as string) || null,
  };
}

export const sendSlackMessageTool: Tool = {
  name: "send_slack_message",
  description:
    "Send a message to a Slack channel or user. To DM someone, pass their user ID (from search_slack_users) as the channelId. Use contentFrom to forward the full output of a prior tool (e.g. generate_sprint_narrative) — the message parameter becomes an optional prefix.",
  parameters: {
    type: "object",
    properties: {
      channelId: {
        type: "string",
        description: "Channel ID or user ID to send to. Use a user ID for DMs.",
      },
      message: {
        type: "string",
        description: "Message text. When using contentFrom, this is prepended as a preamble before the referenced content.",
      },
      contentFrom: {
        type: "string",
        description: "Tool name to pull full content from (e.g. 'generate_sprint_narrative'). The tool's narrative output is used as the message body.",
      },
      threadTs: {
        type: "string",
        description: "Parent message timestamp to reply in a thread (optional).",
      },
    },
    required: ["channelId"],
  },

  async execute(args, context: ExecutionContext) {
    const channelId = args.channelId as string;
    const contentFrom = args.contentFrom as string | undefined;
    const preamble = (args.message as string) || "";
    const threadTs = args.threadTs as string | undefined;

    if (!channelId) throw new Error("channelId is required");

    let message: string;

    if (contentFrom) {
      const content = resolveContentRef(context.toolCallLog, contentFrom);
      if (!content) {
        throw new Error(
          `contentFrom "${contentFrom}" not found in tool call log. ` +
          `Make sure ${contentFrom} was called earlier in this conversation.`
        );
      }
      message = preamble ? `${preamble}\n\n${content}` : content;
    } else {
      if (!preamble) throw new Error("message is required when contentFrom is not set");
      message = preamble;
    }

    const params: Record<string, unknown> = {
      channel_id: channelId,
      message,
    };
    if (threadTs) params.thread_ts = threadTs;

    const result = await callSlackTool("slack_send_message", params);
    const content2 = extractTextContent(result);
    const parsed = parseSendResult(content2);

    const target = channelId.startsWith("U") ? "DM" : "channel";
    const refNote = contentFrom ? ` (content from ${contentFrom})` : "";
    const linkNote = parsed.messageLink ? ` — ${parsed.messageLink}` : "";
    const summary = `Message sent to ${target} ${channelId}${refNote}${linkNote}`;

    return { ...parsed, summary };
  },
};
