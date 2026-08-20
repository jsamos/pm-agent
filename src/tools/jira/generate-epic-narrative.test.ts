import { describe, it, expect } from "vitest";
import { assembleEpicMarkdown, type EpicNarrativeParsed, type EpicHeader } from "./generate-epic-narrative.js";

describe("assembleEpicMarkdown", () => {
  it("renders all sections when data and prose are present", () => {
    const parsed: EpicNarrativeParsed = {
      sectionType: "outcome",
      section: "This epic delivers X.",
      done: ["Completed work paragraph."],
      inMotion: ["Active work paragraph."],
      notStarted: ["Pending work paragraph."],
    };

    const md = assembleEpicMarkdown(parsed, { done: 3, inMotion: 2, notStarted: 1 });

    expect(md).toContain("## Outcome\n\nThis epic delivers X.");
    expect(md).toContain("## What's Been Done\n\nCompleted work paragraph.");
    expect(md).toContain("## What's In Motion\n\nActive work paragraph.");
    expect(md).toContain("## What's Not Started\n\nPending work paragraph.");
  });

  it("uses Unlock heading when sectionType is unlock", () => {
    const parsed: EpicNarrativeParsed = {
      sectionType: "unlock",
      section: "Technical capability.",
    };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 0, notStarted: 0 });
    expect(md).toContain("## Unlock\n\nTechnical capability.");
  });

  it("defaults to Outcome heading for unknown sectionType", () => {
    const parsed: EpicNarrativeParsed = {
      sectionType: "something_else",
      section: "Description.",
    };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 0, notStarted: 0 });
    expect(md).toContain("## Outcome\n\nDescription.");
  });

  it("omits done section when no done issues exist", () => {
    const parsed: EpicNarrativeParsed = {
      done: ["This should not appear."],
      inMotion: ["Active work."],
    };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 2, notStarted: 0 });
    expect(md).not.toContain("What's Been Done");
    expect(md).toContain("What's In Motion");
  });

  it("omits inMotion section when no in-progress issues exist", () => {
    const parsed: EpicNarrativeParsed = {
      done: ["Done work."],
      inMotion: ["This should not appear."],
    };

    const md = assembleEpicMarkdown(parsed, { done: 5, inMotion: 0, notStarted: 0 });
    expect(md).toContain("What's Been Done");
    expect(md).not.toContain("What's In Motion");
  });

  it("omits section when LLM returns empty array", () => {
    const parsed: EpicNarrativeParsed = {
      done: [],
      inMotion: ["Active."],
    };

    const md = assembleEpicMarkdown(parsed, { done: 3, inMotion: 1, notStarted: 0 });
    expect(md).not.toContain("What's Been Done");
    expect(md).toContain("What's In Motion");
  });

  it("joins multiple paragraphs with double newlines", () => {
    const parsed: EpicNarrativeParsed = {
      done: ["First paragraph.", "Second paragraph."],
    };

    const md = assembleEpicMarkdown(parsed, { done: 5, inMotion: 0, notStarted: 0 });
    expect(md).toContain("First paragraph.\n\nSecond paragraph.");
  });

  it("returns empty string when nothing to render", () => {
    const md = assembleEpicMarkdown({}, { done: 0, inMotion: 0, notStarted: 0 });
    expect(md).toBe("");
  });

  it("separates sections with horizontal rules", () => {
    const parsed: EpicNarrativeParsed = {
      sectionType: "outcome",
      section: "Overview.",
      done: ["Done."],
    };

    const md = assembleEpicMarkdown(parsed, { done: 1, inMotion: 0, notStarted: 0 });
    expect(md).toContain("---");
    const parts = md.split("\n\n---\n\n");
    expect(parts).toHaveLength(2);
  });

  it("renders H1 header with epic link when header is provided", () => {
    const header: EpicHeader = {
      key: "PROJ-100",
      summary: "Notification System",
      jiraBase: "https://example.atlassian.net/browse",
    };
    const parsed: EpicNarrativeParsed = {
      sectionType: "outcome",
      section: "Delivers notifications.",
    };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 0, notStarted: 0 }, header);
    expect(md).toContain("# Notification System");
    expect(md).toContain("[PROJ-100](https://example.atlassian.net/browse/PROJ-100)");
    expect(md).not.toContain("Assignee");
  });

  it("includes assignee line when header has assignee", () => {
    const header: EpicHeader = {
      key: "PROJ-200",
      summary: "Data Pipeline",
      jiraBase: "https://example.atlassian.net/browse",
      assignee: "Alice Martin",
    };
    const parsed: EpicNarrativeParsed = { section: "Overview." };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 0, notStarted: 0 }, header);
    expect(md).toContain("# Data Pipeline");
    expect(md).toContain("[PROJ-200]");
    expect(md).toContain("**Assignee:** Alice Martin");
  });

  it("omits assignee line when assignee is null", () => {
    const header: EpicHeader = {
      key: "PROJ-300",
      summary: "Search Feature",
      jiraBase: "https://example.atlassian.net/browse",
      assignee: null,
    };
    const parsed: EpicNarrativeParsed = { section: "Overview." };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 0, notStarted: 0 }, header);
    expect(md).toContain("# Search Feature");
    expect(md).not.toContain("Assignee");
  });

  it("renders without header when header is omitted", () => {
    const parsed: EpicNarrativeParsed = {
      sectionType: "outcome",
      section: "Overview.",
    };

    const md = assembleEpicMarkdown(parsed, { done: 0, inMotion: 0, notStarted: 0 });
    expect(md).not.toMatch(/^# /m);
    expect(md).toContain("## Outcome");
  });
});
