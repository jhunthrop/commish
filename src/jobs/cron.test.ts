import { describe, expect, it } from "vitest";
import { cronMatches, fireInstantsBetween, localMinuteOf, parseCronExpression } from "./cron";

const NY = "America/New_York";

describe("parseCronExpression", () => {
  it("parses the three season fires", () => {
    for (const source of ["0 8 * * 2", "0 18 * * 3", "0 14 * * 4"]) {
      expect(parseCronExpression(source).source).toBe(source);
    }
  });

  it("supports lists, ranges and steps", () => {
    const expr = parseCronExpression("*/15 9-17 1,15 * 1-5");
    expect(expr.minute.values).toEqual(new Set([0, 15, 30, 45]));
    expect(expr.hour.values).toEqual(new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]));
    expect(expr.dayOfMonth.values).toEqual(new Set([1, 15]));
    expect(expr.month.values).toBeNull();
    expect(expr.dayOfWeek.values).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("folds day-of-week 7 to Sunday", () => {
    expect(parseCronExpression("0 0 * * 7").dayOfWeek.values).toEqual(new Set([0]));
  });

  it.each([
    ["0 8 * *", "expected 5 fields"],
    ["60 8 * * 2", "minute range"],
    ["0 24 * * 2", "hour range"],
    ["0 8 * * 8", "day-of-week range"],
    ["5/2 8 * * 2", "step needs a range"],
    ["a 8 * * 2", "not valid"],
  ])("refuses %s", (source, message) => {
    expect(() => parseCronExpression(source)).toThrow(message);
  });
});

describe("localMinuteOf", () => {
  it("reads a UTC instant through a zone", () => {
    // 2026-09-08 is a Tuesday; 12:00Z is 08:00 in New York (EDT, UTC-4).
    const local = localMinuteOf(new Date("2026-09-08T12:00:00Z"), NY);
    expect(local).toEqual({ minute: 0, hour: 8, dayOfMonth: 8, month: 9, dayOfWeek: 2 });
  });

  it("refuses an unknown zone loudly", () => {
    expect(() => localMinuteOf(new Date(), "America/Nowhere")).toThrow();
  });
});

describe("cronMatches", () => {
  const tueData = parseCronExpression("0 8 * * 2");

  it("matches the Tuesday 08:00 ET fire and nothing around it", () => {
    expect(cronMatches(tueData, new Date("2026-09-08T12:00:00Z"), NY)).toBe(true);
    expect(cronMatches(tueData, new Date("2026-09-08T12:01:00Z"), NY)).toBe(false);
    expect(cronMatches(tueData, new Date("2026-09-09T12:00:00Z"), NY)).toBe(false); // Wednesday
  });

  it("tracks DST: the same wall-clock fire is a different UTC instant in January", () => {
    // 2027-01-05 is a Tuesday; New York is EST (UTC-5), so 08:00 local is 13:00Z, not 12:00Z.
    expect(cronMatches(tueData, new Date("2027-01-05T13:00:00Z"), NY)).toBe(true);
    expect(cronMatches(tueData, new Date("2027-01-05T12:00:00Z"), NY)).toBe(false);
  });

  it("uses vixie's either-matches rule when both day fields are restricted", () => {
    const both = parseCronExpression("0 0 13 * 5"); // the 13th OR any Friday
    expect(cronMatches(both, new Date("2026-11-13T05:00:00Z"), NY)).toBe(true); // Friday the 13th
    expect(cronMatches(both, new Date("2026-11-06T05:00:00Z"), NY)).toBe(true); // a plain Friday
    expect(cronMatches(both, new Date("2026-10-13T04:00:00Z"), NY)).toBe(true); // a Tuesday the 13th
    expect(cronMatches(both, new Date("2026-10-14T04:00:00Z"), NY)).toBe(false); // neither
  });
});

describe("fireInstantsBetween (the catch-up walk)", () => {
  const tueData = parseCronExpression("0 8 * * 2");

  it("finds the missed fire inside a laptop-asleep gap", () => {
    const fires = fireInstantsBetween(tueData, NY, new Date("2026-09-07T12:00:00Z"), new Date("2026-09-08T16:00:00Z"));
    expect(fires.map((fire) => fire.toISOString())).toEqual(["2026-09-08T12:00:00.000Z"]);
  });

  it("is exclusive of the start and inclusive of the end", () => {
    const atFire = new Date("2026-09-08T12:00:00Z");
    expect(fireInstantsBetween(tueData, NY, atFire, new Date("2026-09-08T13:00:00Z"))).toEqual([]);
    expect(fireInstantsBetween(tueData, NY, new Date("2026-09-08T11:59:00Z"), atFire)).toHaveLength(1);
  });

  it("finds every fire across a multi-week gap", () => {
    const fires = fireInstantsBetween(tueData, NY, new Date("2026-09-01T00:00:00Z"), new Date("2026-09-16T00:00:00Z"));
    expect(fires.map((fire) => fire.toISOString())).toEqual(["2026-09-01T12:00:00.000Z", "2026-09-08T12:00:00.000Z", "2026-09-15T12:00:00.000Z"]);
  });

  it("fires twice for a wall-clock minute that repeats on fall-back day", () => {
    // 2026-11-01, America/New_York: 01:30 EDT (05:30Z) and 01:30 EST (06:30Z) both exist.
    const halfPastOne = parseCronExpression("30 1 * * *");
    const fires = fireInstantsBetween(halfPastOne, NY, new Date("2026-11-01T04:00:00Z"), new Date("2026-11-01T08:00:00Z"));
    expect(fires.map((fire) => fire.toISOString())).toEqual(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]);
  });

  it("fires zero times for a minute spring-forward skips", () => {
    // 2027-03-14, America/New_York: 02:30 local never happens.
    const halfPastTwo = parseCronExpression("30 2 * * *");
    const fires = fireInstantsBetween(halfPastTwo, NY, new Date("2027-03-14T05:00:00Z"), new Date("2027-03-14T09:00:00Z"));
    expect(fires).toEqual([]);
  });

  it("refuses a reversed window", () => {
    expect(() => fireInstantsBetween(tueData, NY, new Date("2026-09-08T12:00:00Z"), new Date("2026-09-08T11:00:00Z"))).toThrow(
      "before start",
    );
  });
});
