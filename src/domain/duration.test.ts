import { describe, it, expect } from "vitest";
import { formatClockLength } from "./duration";

describe("formatClockLength", () => {
  it("prefers the largest whole unit", () => {
    expect(formatClockLength(8 * 60 * 60)).toBe("8 hours");
    expect(formatClockLength(60 * 60)).toBe("1 hour");
    expect(formatClockLength(10 * 60)).toBe("10 minutes");
    expect(formatClockLength(60)).toBe("1 minute");
    expect(formatClockLength(45)).toBe("45 seconds");
    expect(formatClockLength(1)).toBe("1 second");
  });

  it("falls back to seconds when the value is not a whole number of larger units", () => {
    expect(formatClockLength(90)).toBe("90 seconds");
    expect(formatClockLength(3_601)).toBe("3601 seconds");
  });
});
