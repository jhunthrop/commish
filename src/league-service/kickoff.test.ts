import { describe, expect, it } from "vitest";
import { kickoffInstant } from "./kickoff";

describe("kickoffInstant", () => {
  it("converts a September Sunday 1:00p as EDT (UTC-4)", () => {
    // 2026-09-13 1:00 PM EDT = 17:00 UTC.
    expect(kickoffInstant("20260913", "1:00p")?.toISOString()).toBe("2026-09-13T17:00:00.000Z");
  });

  it("converts a December Sunday 1:00p as EST (UTC-5)", () => {
    // 2026-12-13 1:00 PM EST = 18:00 UTC.
    expect(kickoffInstant("20261213", "1:00p")?.toISOString()).toBe("2026-12-13T18:00:00.000Z");
  });

  it("handles a night game and a morning-noon boundary", () => {
    expect(kickoffInstant("20261210", "8:15p")?.toISOString()).toBe("2026-12-11T01:15:00.000Z");
    // 12:30p is 12:30, never 00:30.
    expect(kickoffInstant("20261225", "12:30p")?.toISOString()).toBe("2026-12-25T17:30:00.000Z");
  });

  it("answers null for an absent or unparsable half, never a guessed instant", () => {
    expect(kickoffInstant("", "1:00p")).toBeNull();
    expect(kickoffInstant("20261213", "")).toBeNull();
    expect(kickoffInstant("20261213", "TBD")).toBeNull();
    expect(kickoffInstant("2026-12-13", "1:00p")).toBeNull();
  });
});
