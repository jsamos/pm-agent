import { describe, it, expect } from "vitest";
import { createRegistry } from "./registry.js";

describe("createRegistry", () => {
  it("exposes harness tools only — no raw MCP tool names", () => {
    const registry = createRegistry();
    const names = registry.list().map((t) => t.name);

    expect(names).toContain("fetch_notion_page");
    expect(names).toContain("send_slack_message");
    expect(names).toContain("search_slack_users");
    expect(names).not.toContain("notion-fetch");
    expect(names).not.toContain("notion-create-pages");
    expect(names).not.toContain("notion-update-page");
    expect(names).not.toContain("slack_send_message");
    expect(names).not.toContain("slack_search_users");
    expect(names).toContain("cascade_epic_notion_updates");
  });
});
