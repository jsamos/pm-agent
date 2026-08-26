import { describe, it, expect, vi, beforeEach } from "vitest";

const connect = vi.fn(async () => ({ id: "mock-slack-client" }));

vi.mock("../../lib/connection.js", () => ({
  connect,
  callTool: vi.fn(),
}));

describe("getSlackClient", () => {
  beforeEach(async () => {
    vi.resetModules();
    connect.mockClear();
  });

  it("connects lazily on first call and reuses the client", async () => {
    const { getSlackClient } = await import("./client.js");
    const first = await getSlackClient();
    const second = await getSlackClient();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith("slack");
    expect(first).toBe(second);
  });
});
