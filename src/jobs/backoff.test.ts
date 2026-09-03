import { describe, expect, it } from "vitest";
import { backoffDelayMs } from "./backoff";

const POLICY = { baseMs: 60_000, maxMs: 3_600_000 };

describe("backoffDelayMs", () => {
  it("doubles per attempt at the jitter ceiling", () => {
    const atCeiling = () => 1 - Number.EPSILON;
    expect(backoffDelayMs(POLICY, 1, atCeiling)).toBe(60_000);
    expect(backoffDelayMs(POLICY, 2, atCeiling)).toBe(120_000);
    expect(backoffDelayMs(POLICY, 3, atCeiling)).toBe(240_000);
  });

  it("caps at maxMs", () => {
    expect(backoffDelayMs(POLICY, 20, () => 1 - Number.EPSILON)).toBe(3_600_000);
  });

  it("jitters no lower than half the exponential delay", () => {
    expect(backoffDelayMs(POLICY, 3, () => 0)).toBe(120_000); // half of 240s
  });

  it("stays within [half, full] for any random draw", () => {
    for (const draw of [0, 0.25, 0.5, 0.75, 0.999]) {
      const delay = backoffDelayMs(POLICY, 4, () => draw);
      expect(delay).toBeGreaterThanOrEqual(240_000);
      expect(delay).toBeLessThanOrEqual(480_000);
    }
  });

  it("refuses a nonsense attempt number", () => {
    expect(() => backoffDelayMs(POLICY, 0, () => 0.5)).toThrow("attempt must be >= 1");
  });
});
