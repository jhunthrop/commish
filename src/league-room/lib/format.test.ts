import { describe, it, expect } from "vitest";
import { daysUntil, formatExpiry, formatPoints, formatRecord, formatWeek } from "./format";

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

  it("never goes negative for a timestamp already in the past", () => {
    expect(daysUntil("2026-08-20T00:00:00.000Z", NOW)).toBe(0);
  });
});

describe("formatExpiry", () => {
  it("says today, tomorrow, or a count, never a fraction", () => {
    expect(formatExpiry(0)).toBe("Expires today.");
    expect(formatExpiry(1)).toBe("Expires tomorrow.");
    expect(formatExpiry(3)).toBe("Expires in 3 days.");
  });

  it("carries no em dash or en dash", () => {
    for (const days of [0, 1, 3]) expect(formatExpiry(days)).not.toMatch(/[–—]/);
  });
});
