import { describe, it, expect } from "vitest";
import { clockTierFor, hoursUntil, nextTighteningAfter, tierIndexFor } from "./clock-schedule";

const KICKOFF = "2026-09-10T17:00:00.000Z";

describe("hoursUntil", () => {
  it("measures whole and fractional hours to kickoff", () => {
    expect(hoursUntil("2026-09-10T15:00:00.000Z", KICKOFF)).toBe(2);
    expect(hoursUntil("2026-09-10T16:30:00.000Z", KICKOFF)).toBe(0.5);
  });
  it("goes negative once kickoff has passed", () => {
    expect(hoursUntil("2026-09-10T20:00:00.000Z", KICKOFF)).toBe(-3);
  });
  it("throws a clear error for an unparseable timestamp", () => {
    expect(() => hoursUntil("not-a-date", KICKOFF)).toThrow(/ISO timestamp/);
    expect(() => hoursUntil(KICKOFF, "not-a-date")).toThrow(/ISO timestamp/);
  });
});

describe("clockTierFor — every boundary of the 8h → 4h → 1h → 10m → 1:30 schedule", () => {
  it.each([
    ["8 days out", "2026-09-02T09:00:00.000Z", 8 * 3600],
    ["exactly 168h out (boundary)", "2026-09-03T17:00:00.000Z", 4 * 3600],
    ["100h out", "2026-09-06T13:00:00.000Z", 4 * 3600],
    ["exactly 48h out (boundary)", "2026-09-08T17:00:00.000Z", 3600],
    ["13h out", "2026-09-10T04:00:00.000Z", 3600],
    ["exactly 12h out (boundary)", "2026-09-10T05:00:00.000Z", 600],
    ["2.5h out", "2026-09-10T14:30:00.000Z", 600],
    ["exactly 2h out (boundary)", "2026-09-10T15:00:00.000Z", 90],
    ["30m out", "2026-09-10T16:30:00.000Z", 90],
    ["exactly at kickoff", "2026-09-10T17:00:00.000Z", 90],
    ["after kickoff", "2026-09-10T20:00:00.000Z", 90],
  ])("%s → %i second picks", (_label, at, pickSeconds) => {
    expect(clockTierFor(at, KICKOFF).pickSeconds).toBe(pickSeconds);
  });

  it("returns the index of the applicable tier", () => {
    expect(tierIndexFor("2026-09-02T09:00:00.000Z", KICKOFF)).toBe(0);
    expect(tierIndexFor("2026-09-10T16:30:00.000Z", KICKOFF)).toBe(4);
  });

  it("uses a caller-supplied schedule instead of the default", () => {
    const schedule = [
      { untilHoursBeforeKickoff: 24, pickSeconds: 120 },
      { untilHoursBeforeKickoff: 0, pickSeconds: 30 },
    ];
    expect(clockTierFor("2026-09-01T00:00:00.000Z", KICKOFF, schedule).pickSeconds).toBe(120);
    expect(clockTierFor("2026-09-10T16:00:00.000Z", KICKOFF, schedule).pickSeconds).toBe(30);
  });

  it("throws on an empty schedule rather than silently having no clock", () => {
    expect(() => clockTierFor("2026-09-01T00:00:00.000Z", KICKOFF, [])).toThrow(/schedule/i);
  });
});

describe("nextTighteningAfter", () => {
  it.each([
    ["8 days out", "2026-09-02T09:00:00.000Z", "2026-09-03T17:00:00.000Z", 4 * 3600],
    ["100h out", "2026-09-06T13:00:00.000Z", "2026-09-08T17:00:00.000Z", 3600],
    ["13h out", "2026-09-10T04:00:00.000Z", "2026-09-10T05:00:00.000Z", 600],
    ["2.5h out", "2026-09-10T14:30:00.000Z", "2026-09-10T15:00:00.000Z", 90],
  ])("from %s the clock next shortens at %s to %i seconds", (_label, at, expectedAt, pickSeconds) => {
    expect(nextTighteningAfter(at, KICKOFF)).toEqual({ at: expectedAt, pickSeconds });
  });

  it("returns null on the final tier — the clock can't tighten further", () => {
    expect(nextTighteningAfter("2026-09-10T16:30:00.000Z", KICKOFF)).toBeNull();
  });
});
