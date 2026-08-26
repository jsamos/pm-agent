import { describe, it, expect, vi, beforeEach } from "vitest";

const connect = vi.fn(async () => ({ id: "mock-notion-client" }));

vi.mock("../../lib/connection.js", () => ({
  connect,
  callTool: vi.fn(),
}));

describe("getNotionClient", () => {
  beforeEach(async () => {
    vi.resetModules();
    connect.mockClear();
  });

  it("connects lazily on first call and reuses the client", async () => {
    const { getNotionClient } = await import("./client.js");
    const first = await getNotionClient();
    const second = await getNotionClient();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith("notion");
    expect(first).toBe(second);
  });
});
