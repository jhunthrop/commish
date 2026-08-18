import { describe, it, expect } from "vitest";
import { formatPoints, formatRecord, formatWeek } from "./format";

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
