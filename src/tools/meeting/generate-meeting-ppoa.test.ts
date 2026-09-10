import { describe, it, expect, vi } from "vitest";
import { generateMeetingPpoaTool } from "./generate-meeting-ppoa.js";
import type { ToolCallEntry } from "../../lib/agent-loop.js";

const SAMPLE_PPOA = `## Product Requirements
- System must support both professional and institutional claim types

## Project Management
- Team is focused on first end-to-end claim submission

## Open Questions
- How should multi-provider encounters be handled?

## Action Items
- Alice → fix provider-build logic`;

function buildContext(opts: {
  toolCallLog?: ToolCallEntry[];
  generateResponse?: string;
}) {
  const llm = {
    generate: vi.fn().mockResolvedValue({
      content: opts.generateResponse ?? SAMPLE_PPOA,
      finishReason: "stop",
    }),
  };

  return {
    llm,
    config: {},
    toolCallLog: opts.toolCallLog ?? [],
  } as any;
}

describe("generate_meeting_ppoa", () => {
  it("reads transcript from prior fetch_notion_transcript result", async () => {
    const log: ToolCallEntry[] = [
      {
        tool: "fetch_notion_transcript",
        args: { pageUrl: "https://notion.so/abc" },
        result: {
          title: "Team Sync — 2026-09-10",
          transcript: "Alice: Let's review the spec.\nBob: Sounds good.",
          pageId: "abc123",
          url: "https://notion.so/abc",
          charCount: 47,
        },
        durationMs: 100,
      },
    ];

    const ctx = buildContext({ toolCallLog: log });
    const result = (await generateMeetingPpoaTool.execute!({}, ctx)) as {
      ppoa: string;
      summary: string;
    };

    expect(ctx.llm.generate).toHaveBeenCalledOnce();
    const [messages] = ctx.llm.generate.mock.calls[0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("PPOA");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("Alice: Let's review the spec.\nBob: Sounds good.");

    expect(result.ppoa).toContain("# Team Sync — 2026-09-10");
    expect(result.ppoa).toContain("## Product Requirements");
  });

  it("accepts transcript directly as a parameter", async () => {
    const ctx = buildContext({});
    const result = (await generateMeetingPpoaTool.execute!(
      { transcript: "Alice: Let's talk about the API.\nBob: Sure.", title: "API Review" },
      ctx,
    )) as { ppoa: string };

    const [messages] = ctx.llm.generate.mock.calls[0];
    expect(messages[1].content).toBe("Alice: Let's talk about the API.\nBob: Sure.");
    expect(result.ppoa).toContain("# API Review");
  });

  it("throws when no transcript is available", async () => {
    const ctx = buildContext({});
    await expect(
      generateMeetingPpoaTool.execute!({}, ctx),
    ).rejects.toThrow("No transcript available");
  });

  it("returns failure summary when LLM returns empty", async () => {
    const ctx = buildContext({
      toolCallLog: [
        {
          tool: "fetch_notion_transcript",
          args: {},
          result: { title: "Meeting", transcript: "Some text", charCount: 9 },
          durationMs: 50,
        },
      ],
      generateResponse: "",
    });

    const result = (await generateMeetingPpoaTool.execute!({}, ctx)) as {
      ppoa: string;
      summary: string;
    };
    expect(result.ppoa).toBe("");
    expect(result.summary).toContain("failed");
  });
});
