import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSendResult, sendSlackMessageTool } from "./send-message.js";

vi.mock("./client.js", () => ({
  callSlackTool: vi.fn(async () => ({
    content: [{ type: "text", text: JSON.stringify({
      ok: true,
      channel: "C12345",
      ts: "1234567890.123456",
      message_link: "https://example.slack.com/archives/C12345/p1234567890123456",
    }) }],
    isError: false,
  })),
  extractTextContent: vi.fn((result: { content: { text: string }[] }) =>
    JSON.parse(result.content[0].text),
  ),
}));

vi.mock("../../lib/agent-loop.js", () => ({
  trace: vi.fn(),
}));

describe("parseSendResult", () => {
  it("parses a structured JSON response", () => {
    const raw = {
      ok: true,
      channel: "C12345",
      ts: "1234567890.123456",
      message_link: "https://example.slack.com/archives/C12345/p1234567890123456",
    };

    const result = parseSendResult(raw);
    expect(result.ok).toBe(true);
    expect(result.channelId).toBe("C12345");
    expect(result.timestamp).toBe("1234567890.123456");
    expect(result.messageLink).toBe("https://example.slack.com/archives/C12345/p1234567890123456");
  });

  it("handles permalink field instead of message_link", () => {
    const raw = {
      ok: true,
      channel: "C99999",
      ts: "111.222",
      permalink: "https://example.slack.com/archives/C99999/p111222",
    };

    const result = parseSendResult(raw);
    expect(result.messageLink).toBe("https://example.slack.com/archives/C99999/p111222");
  });

  it("parses markdown response in results field", () => {
    const raw = {
      results: "Message sent to #general\nMessage link: https://example.slack.com/archives/C12345/p999\n",
    };

    const result = parseSendResult(raw);
    expect(result.ok).toBe(true);
    expect(result.messageLink).toBe("https://example.slack.com/archives/C12345/p999");
  });

  it("throws on error in markdown response", () => {
    const raw = { results: "Error: channel_not_found" };
    expect(() => parseSendResult(raw)).toThrow("Slack send failed");
  });

  it("throws on structured ok:false response", () => {
    const raw = { ok: false, error: "channel_not_found" };
    expect(() => parseSendResult(raw)).toThrow("channel_not_found");
  });

  it("throws on error in plain string response", () => {
    expect(() => parseSendResult("Error: not_authed")).toThrow("Slack send failed");
  });

  it("parses plain string success response", () => {
    const raw = "Message sent — https://example.slack.com/archives/C12345/p111";

    const result = parseSendResult(raw);
    expect(result.ok).toBe(true);
    expect(result.messageLink).toBe("https://example.slack.com/archives/C12345/p111");
  });
});

describe("sendSlackMessageTool.execute", () => {
  let mockCallSlackTool: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const client = await import("./client.js");
    mockCallSlackTool = client.callSlackTool as ReturnType<typeof vi.fn>;
    mockCallSlackTool.mockClear();
    mockCallSlackTool.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          channel: "C12345",
          ts: "1234567890.123456",
          message_link: "https://example.slack.com/archives/C12345/p1234567890123456",
        }),
      }],
      isError: false,
    });
  });

  // [tested] Scenario: Post to channel
  it("sends a message to a channel", async () => {
    const result = await sendSlackMessageTool.execute!(
      { channelId: "C12345", message: "Hello team" },
      { toolCallLog: [], config: {} } as any,
    );

    expect(mockCallSlackTool).toHaveBeenCalledWith("slack_send_message", {
      channel_id: "C12345",
      message: "Hello team",
    });
    expect((result as any).messageLink).toContain("slack.com");
  });

  // [tested] Scenario: Direct message by user ID
  it("sends a DM when channelId is a user ID", async () => {
    mockCallSlackTool.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          channel: "D99999",
          ts: "111.222",
          message_link: "https://example.slack.com/archives/D99999/p111222",
        }),
      }],
      isError: false,
    });

    const result = await sendSlackMessageTool.execute!(
      { channelId: "U001", message: "Hi Alice" },
      { toolCallLog: [], config: {} } as any,
    );

    expect(mockCallSlackTool).toHaveBeenCalledWith("slack_send_message", {
      channel_id: "U001",
      message: "Hi Alice",
    });
    expect((result as any).summary).toContain("DM");
  });

  // [tested] Scenario: Thread reply
  it("includes thread_ts when replying in a thread", async () => {
    await sendSlackMessageTool.execute!(
      {
        channelId: "C12345",
        message: "Reply text",
        threadTs: "1234567890.123456",
      },
      { toolCallLog: [], config: {} } as any,
    );

    expect(mockCallSlackTool).toHaveBeenCalledWith("slack_send_message", {
      channel_id: "C12345",
      message: "Reply text",
      thread_ts: "1234567890.123456",
    });
  });

  it("uses contentFrom when provided", async () => {
    const narrative = "# Sprint Report\n\nFull report body.";
    await sendSlackMessageTool.execute!(
      {
        channelId: "C12345",
        contentFrom: "generate_sprint_narrative",
        message: "Sprint update:",
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

    expect(mockCallSlackTool).toHaveBeenCalledWith("slack_send_message", {
      channel_id: "C12345",
      message: `Sprint update:\n\n${narrative}`,
    });
  });
});
