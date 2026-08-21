import { describe, it, expect } from "vitest";
import { daysUntil, formatExpired, formatExpiry, formatPoints, formatRecord, formatWeek } from "./format";

describe("league display formatting", () => {
  it("writes a record, dropping ties when there are none", () => {
    expect(formatRecord({ wins: 9, losses: 4, ties: 0 })).toBe("9-4");
    expect(formatRecord({ wins: 9, losses: 4, ties: 1 })).toBe("9-4-1");
    expect(formatRecord({ wins: 0, losses: 0, ties: 0 })).toBe("0-0");
  });

  it("writes points to two decimals, always", () => {
    expect(formatPoints(112.5)).toBe("112.50");
    expect(formatPoints(0)).toBe("0.00");
  });

  it("writes a week", () => {
    expect(formatWeek(3)).toBe("Week 3");
  });
});

describe("daysUntil", () => {
  const NOW = new Date("2026-08-21T12:00:00.000Z");

  it("floors to whole days, never claiming a day that hasn't started", () => {
    expect(daysUntil("2026-08-24T11:59:00.000Z", NOW)).toBe(2); // 23h59m short of 3 full days
    expect(daysUntil("2026-08-24T12:00:00.000Z", NOW)).toBe(3);
  });

  /** Final review, HIGH 3: this used to clamp at zero, which turned an offer that died three
   *  days ago into "Expires today." — false copy, not merely stale. A count that goes negative is
   *  what lets the sentence below tell the truth. */
  it("goes negative for a timestamp already in the past, rather than clamping to today", () => {
    expect(daysUntil("2026-08-20T00:00:00.000Z", NOW)).toBe(-2);
    expect(daysUntil("2026-08-21T11:00:00.000Z", NOW)).toBe(-1);
  });
});

describe("formatExpiry", () => {
  it("says today, tomorrow, or a count, never a fraction", () => {
    expect(formatExpiry(0)).toBe("Expires today.");
    expect(formatExpiry(1)).toBe("Expires tomorrow.");
    expect(formatExpiry(3)).toBe("Expires in 3 days.");
  });

  it("never claims a past-due offer expires today", () => {
    expect(formatExpiry(-1)).toBe("Expired.");
    expect(formatExpiry(-30)).toBe("Expired.");
  });

  it("carries no em dash or en dash", () => {
    for (const days of [-1, 0, 1, 3]) expect(formatExpiry(days)).not.toMatch(/[–—]/);
  });
});

describe("formatExpired", () => {
  it("names the day the offer ran out, in words a reader does not have to decode", () => {
    expect(formatExpired("2026-08-18T12:00:00.000Z")).toBe("Expired August 18.");
    expect(formatExpired("2026-01-03T23:00:00.000Z")).toBe("Expired January 3.");
  });

  it("carries no em dash or en dash", () => {
    expect(formatExpired("2026-08-18T12:00:00.000Z")).not.toMatch(/[–—]/);
  });
});
