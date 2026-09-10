import { describe, it, expect } from "vitest";
import { extractTranscriptText, extractMeetingTitle, extractPageUrl } from "./notion-transcript.js";

const MEETING_PAGE = [
  '<page url="https://app.notion.com/p/abc123">',
  "<ancestor-path></ancestor-path>",
  "<content>",
  '<meeting-notes attendees="user://u1,user://u2">',
  "\tTeam Sync — 2026-09-10",
  "\t<summary>",
  "\t\t### Action Items",
  "\t\t- [ ] Alice to review the spec",
  "\t</summary>",
  "\t<notes>",
  "\t\t<empty-block/>",
  "\t</notes>",
  "\t<transcript>",
  "\t\tAlice: Let's review the spec today.",
  "\t\tBob: Sounds good. I'll send the draft.",
  "\t\tAlice: Great, let's wrap up.",
  "\t</transcript>",
  "</meeting-notes>",
  "</content>",
  "</page>",
].join("\n");

const OMITTED_PAGE = MEETING_PAGE.replace(
  /<transcript>[\s\S]*?<\/transcript>/,
  '<transcript>\n\t\tTranscript omitted. Use the view tool with the meeting note url.\n\t</transcript>',
);

const NO_TRANSCRIPT_PAGE = [
  '<page url="https://app.notion.com/p/abc123">',
  "<content>",
  "# Regular Page",
  "",
  "Some plain content.",
  "</content>",
  "</page>",
].join("\n");

describe("extractTranscriptText", () => {
  // Scenario: Fetch transcript by URL
  it("extracts and dedents transcript from meeting-notes XML", () => {
    const result = extractTranscriptText(MEETING_PAGE);
    expect(result).toBe(
      "Alice: Let's review the spec today.\nBob: Sounds good. I'll send the draft.\nAlice: Great, let's wrap up.",
    );
  });

  it("returns null when transcript is omitted placeholder", () => {
    expect(extractTranscriptText(OMITTED_PAGE)).toBeNull();
  });

  it("returns null when no transcript tag is present", () => {
    expect(extractTranscriptText(NO_TRANSCRIPT_PAGE)).toBeNull();
  });

  it("returns null for empty transcript block", () => {
    const empty = MEETING_PAGE.replace(
      /<transcript>[\s\S]*?<\/transcript>/,
      "<transcript>\n\t\t\n\t</transcript>",
    );
    expect(extractTranscriptText(empty)).toBeNull();
  });
});

describe("extractMeetingTitle", () => {
  it("extracts title from meeting-notes tag", () => {
    expect(extractMeetingTitle(MEETING_PAGE)).toBe("Team Sync — 2026-09-10");
  });

  it("returns null when no meeting-notes tag", () => {
    expect(extractMeetingTitle(NO_TRANSCRIPT_PAGE)).toBeNull();
  });
});

describe("extractPageUrl", () => {
  it("extracts URL from page tag", () => {
    expect(extractPageUrl(MEETING_PAGE)).toBe("https://app.notion.com/p/abc123");
  });

  it("returns null when no page tag", () => {
    expect(extractPageUrl("no page here")).toBeNull();
  });
});
