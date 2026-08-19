import { describe, it, expect } from "vitest";
import { formatChatTime } from "./format";

describe("formatChatTime", () => {
  it("renders a wall-clock time, not a raw ISO string", () => {
    const formatted = formatChatTime("2026-08-18T12:34:00.000Z");
    expect(formatted).not.toContain("T");
    expect(formatted).toMatch(/\d/);
  });

  it("hands back the input unchanged when it isn't a date we can read", () => {
    expect(formatChatTime("not-a-date")).toBe("not-a-date");
  });
});
