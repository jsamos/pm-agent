import { describe, it, expect } from "vitest";
import { resolveDescriptionLimit } from "./narrative-config.js";

describe("resolveDescriptionLimit", () => {
  it("returns jira.example.json default when no override", () => {
    expect(resolveDescriptionLimit()).toBe(1000);
  });

  it("uses jira.json override when provided", () => {
    expect(resolveDescriptionLimit({ descriptionLimit: 500 })).toBe(500);
  });

  it("ignores non-number overrides", () => {
    expect(resolveDescriptionLimit({ descriptionLimit: "lots" })).toBe(1000);
  });
});
