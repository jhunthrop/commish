import { describe, expect, it } from "vitest";
import { toHistoricalDateParam } from "./http";

describe("toHistoricalDateParam — the historical API's own date format, no fractional seconds", () => {
  it("strips the .000Z millisecond suffix toISOString() always adds", () => {
    expect(toHistoricalDateParam(new Date("2023-09-07T16:20:00.000Z"))).toBe("2023-09-07T16:20:00Z");
  });

  it("strips a non-zero millisecond component too, not just .000", () => {
    expect(toHistoricalDateParam(new Date("2023-09-07T16:20:00.456Z"))).toBe("2023-09-07T16:20:00Z");
  });

  it("matches the API docs' own example format exactly", () => {
    expect(toHistoricalDateParam(new Date("2024-04-30T12:45:00.000Z"))).toBe("2024-04-30T12:45:00Z");
  });
});
