import { describe, it, expect } from "vitest";
import { formatCountdown, formatClockLength, formatGap, formatTightening } from "./format";

describe("formatCountdown", () => {
  it.each([
    [0, "0:00"],
    [-5_000, "0:00"],
    [9_400, "0:10"],
    [125_000, "2:05"],
    [3_849_000, "1:04:09"],
  ])("renders %i ms as %s", (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});

describe("formatClockLength", () => {
  it.each([
    [8 * 60 * 60, "8 hours"],
    [60 * 60, "1 hour"],
    [10 * 60, "10 minutes"],
    [60, "1 minute"],
    [45, "45 seconds"],
    [1, "1 second"],
    [90, "90 seconds"],
  ])("renders %i seconds as %s", (seconds, expected) => {
    expect(formatClockLength(seconds)).toBe(expected);
  });
});

describe("formatGap", () => {
  it.each([
    [0, "under a minute"],
    [-10, "under a minute"],
    [59_000, "under a minute"],
    [14 * 60_000, "14m"],
    [134 * 60_000, "2h 14m"],
  ])("renders %i ms as %s", (ms, expected) => {
    expect(formatGap(ms)).toBe(expected);
  });
});

describe("formatTightening", () => {
  it("is null when nothing is scheduled to change", () => {
    expect(formatTightening(null, 0)).toBeNull();
  });

  it("says what it shortens to and when", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    expect(formatTightening({ at: "2026-09-01T02:14:00.000Z", pickSeconds: 600 }, now)).toBe("Picks shorten to 10 minutes in 2h 14m");
  });
});
