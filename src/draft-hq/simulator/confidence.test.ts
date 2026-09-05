import { describe, expect, it } from "vitest";
import { showsConfidenceInterval, wilsonInterval } from "./confidence";

describe("wilsonInterval", () => {
  it("returns [0, 0] for zero trials", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 0 });
  });

  it("is centered near the observed rate for a large n", () => {
    const { low, high } = wilsonInterval(500, 1000);
    expect(low).toBeGreaterThan(0.46);
    expect(high).toBeLessThan(0.54);
  });

  it("never goes below 0 or above 1, even at the extremes", () => {
    expect(wilsonInterval(0, 10).low).toBeGreaterThanOrEqual(0);
    expect(wilsonInterval(10, 10).high).toBeLessThanOrEqual(1);
  });

  it("widens as the sample shrinks, for the identical observed rate", () => {
    const wide = wilsonInterval(5, 10); // 50% of 10
    const narrow = wilsonInterval(5000, 10000); // 50% of 10,000
    expect(wide.high - wide.low).toBeGreaterThan(narrow.high - narrow.low);
  });
});

describe("showsConfidenceInterval", () => {
  it("shows at 100 runs", () => {
    expect(showsConfidenceInterval(100)).toBe(true);
  });

  it("suppresses at 10,000 runs", () => {
    expect(showsConfidenceInterval(10_000)).toBe(false);
  });
});
