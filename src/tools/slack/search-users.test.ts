import { describe, it, expect } from "vitest";
import { parseSlackUsers } from "./search-users.js";

describe("parseSlackUsers", () => {
  it("parses users from Slack MCP markdown response", () => {
    const raw = {
      results: [
        "# Search Results for: alice\n",
        "\n## Users (2 results)\n",
        "### Result 1 of 2\n",
        "Name: Alice Martin\n",
        "User ID: U001\n",
        "Title: Engineer\n",
        "Email: alice@example.com\n",
        "\n---\n\n",
        "### Result 2 of 2\n",
        "Name: Bob Chen\n",
        "User ID: U002\n",
        "Title: Designer\n",
        "Email: bob@example.com\n",
        "\n---\n\n",
      ].join(""),
      pagination_info: "End of results",
    };

    const users = parseSlackUsers(raw);
    expect(users).toHaveLength(2);

    expect(users[0].userId).toBe("U001");
    expect(users[0].displayName).toBe("Alice Martin");
    expect(users[0].realName).toBe("Alice Martin");
    expect(users[0].email).toBe("alice@example.com");

    expect(users[1].userId).toBe("U002");
    expect(users[1].realName).toBe("Bob Chen");
    expect(users[1].email).toBe("bob@example.com");
  });

  it("returns empty array for 0 results", () => {
    const raw = {
      results: "# Search Results\n\n## Users (0 results)\n\n---\n\n",
    };
    expect(parseSlackUsers(raw)).toEqual([]);
  });

  it("handles single user result", () => {
    const raw = {
      results: [
        "# Search Results for: carol\n\n",
        "## Users (1 results)\n",
        "### Result 1 of 1\n",
        "Name: Carol Davis\n",
        "User ID: U003\n",
        "Title: PM\n",
        "Timezone: America/New_York\n",
        "\n---\n\n",
      ].join(""),
    };

    const users = parseSlackUsers(raw);
    expect(users).toHaveLength(1);
    expect(users[0].userId).toBe("U003");
    expect(users[0].displayName).toBe("Carol Davis");
    expect(users[0].email).toBeNull();
  });

  it("throws on missing results key", () => {
    expect(() => parseSlackUsers({})).toThrow("Unexpected Slack response shape");
  });

  it("throws on raw string response", () => {
    expect(() => parseSlackUsers("something unexpected")).toThrow("Unexpected Slack response");
  });

  it("throws on error in results text", () => {
    const raw = { results: "Error: user_not_found" };
    expect(() => parseSlackUsers(raw)).toThrow("Slack user search failed");
  });
});
