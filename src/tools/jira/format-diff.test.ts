import { describe, it, expect } from "vitest";
import { extractDiffFromLog, formatDiffBlock, type DiffData } from "./format-diff.js";

const JIRA_BASE = "https://example.atlassian.net/browse";

describe("formatDiffBlock", () => {
  it("returns empty string when no baseline", () => {
    const diff: DiffData = { changed: false, added: [], removed: [], statusChanges: [], baselineTimestamp: null };
    expect(formatDiffBlock(diff, JIRA_BASE)).toBe("");
  });

  it("renders no-changes message", () => {
    const diff: DiffData = { changed: false, added: [], removed: [], statusChanges: [], baselineTimestamp: "2026-08-17T14:30" };
    expect(formatDiffBlock(diff, JIRA_BASE)).toBe("> **No changes since 2026-08-17T14:30.**");
  });

  it("renders added issues with links", () => {
    const diff: DiffData = {
      changed: true,
      added: ["PROJ-100", "PROJ-101"],
      removed: [],
      statusChanges: [],
      baselineTimestamp: "2026-08-17T14:30",
    };
    const result = formatDiffBlock(diff, JIRA_BASE);
    expect(result).toContain("2 added");
    expect(result).toContain("[PROJ-100](https://example.atlassian.net/browse/PROJ-100)");
    expect(result).toContain("[PROJ-101](https://example.atlassian.net/browse/PROJ-101)");
  });

  it("renders removed issues with links", () => {
    const diff: DiffData = {
      changed: true,
      added: [],
      removed: ["PROJ-50"],
      statusChanges: [],
      baselineTimestamp: "2026-08-17T14:30",
    };
    const result = formatDiffBlock(diff, JIRA_BASE);
    expect(result).toContain("1 removed");
    expect(result).toContain("[PROJ-50](https://example.atlassian.net/browse/PROJ-50)");
  });

  it("renders status changes with from/to", () => {
    const diff: DiffData = {
      changed: true,
      added: [],
      removed: [],
      statusChanges: [
        { key: "PROJ-200", was: "To Do", now: "In Progress" },
        { key: "PROJ-201", was: "In Progress", now: "Done" },
      ],
      baselineTimestamp: "2026-08-17T14:30",
    };
    const result = formatDiffBlock(diff, JIRA_BASE);
    expect(result).toContain("2 status changes");
    expect(result).toContain("PROJ-200](https://example.atlassian.net/browse/PROJ-200): To Do → In Progress");
    expect(result).toContain("PROJ-201](https://example.atlassian.net/browse/PROJ-201): In Progress → Done");
  });

  it("combines added, removed, and status changes with semicolons", () => {
    const diff: DiffData = {
      changed: true,
      added: ["X-1"],
      removed: ["X-2"],
      statusChanges: [{ key: "X-3", was: "To Do", now: "Done" }],
      baselineTimestamp: "2026-08-17T10:00",
    };
    const result = formatDiffBlock(diff, JIRA_BASE);
    expect(result).toContain("; ");
    expect(result).toContain("1 added");
    expect(result).toContain("1 removed");
    expect(result).toContain("1 status change (");
  });

  it("uses singular for single status change", () => {
    const diff: DiffData = {
      changed: true,
      added: [],
      removed: [],
      statusChanges: [{ key: "X-1", was: "To Do", now: "Done" }],
      baselineTimestamp: "2026-08-17T10:00",
    };
    const result = formatDiffBlock(diff, JIRA_BASE);
    expect(result).toContain("1 status change (");
    expect(result).not.toContain("changes");
  });
});

describe("extractDiffFromLog", () => {
  it("returns null when no diff in log", () => {
    const log = [{ tool: "search_jira_issues", args: {}, result: { issues: [] } }];
    expect(extractDiffFromLog(log)).toBeNull();
  });

  it("returns null when diff has no baseline (first run)", () => {
    const log = [{
      tool: "jira_search_snapshots",
      args: { action: "diff" },
      result: { changed: true, added: ["X-1"], removed: [], statusChanges: [], baselineTimestamp: null },
    }];
    expect(extractDiffFromLog(log)).toBeNull();
  });

  it("extracts diff data from log", () => {
    const log = [
      { tool: "search_jira_issues", args: {}, result: { issues: [] } },
      {
        tool: "jira_search_snapshots",
        args: { action: "diff" },
        result: {
          changed: true,
          added: ["X-1"],
          removed: [],
          statusChanges: [{ key: "X-2", was: "To Do", now: "Done" }],
          baselineTimestamp: "2026-08-17T14:30",
        },
      },
    ];
    const diff = extractDiffFromLog(log);
    expect(diff).not.toBeNull();
    expect(diff!.changed).toBe(true);
    expect(diff!.added).toEqual(["X-1"]);
    expect(diff!.baselineTimestamp).toBe("2026-08-17T14:30");
  });

  it("uses the most recent diff entry", () => {
    const log = [
      {
        tool: "jira_search_snapshots",
        args: { action: "diff" },
        result: { changed: false, added: [], removed: [], statusChanges: [], baselineTimestamp: "2026-08-16T10:00" },
      },
      {
        tool: "jira_search_snapshots",
        args: { action: "diff" },
        result: { changed: true, added: ["X-1"], removed: [], statusChanges: [], baselineTimestamp: "2026-08-17T14:30" },
      },
    ];
    const diff = extractDiffFromLog(log);
    expect(diff!.baselineTimestamp).toBe("2026-08-17T14:30");
  });

  it("ignores non-diff snapshot actions", () => {
    const log = [
      { tool: "jira_search_snapshots", args: { action: "save" }, result: { summary: "Saved" } },
      { tool: "jira_search_snapshots", args: { action: "count" }, result: { summary: "5" } },
    ];
    expect(extractDiffFromLog(log)).toBeNull();
  });
});
