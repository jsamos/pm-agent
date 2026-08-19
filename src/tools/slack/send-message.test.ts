import { describe, it, expect } from "vitest";
import { parseSendResult } from "./send-message.js";

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
