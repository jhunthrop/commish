import { describe, expect, it } from "vitest";
import { bootstrapRankCorrelationDifference, type RankCorrelationDifferenceRow } from "./rank-correlation-bootstrap";

const SEED = 20260901;

/** A population where `actual` is just the index, `primary` copies it exactly (perfect rank
 *  correlation) and `baseline` runs it backwards (perfect NEGATIVE rank correlation) — the largest
 *  possible separation, so a real bootstrap population has to find it "beyond noise". */
function separatedRows(n: number): readonly RankCorrelationDifferenceRow[] {
  return Array.from({ length: n }, (_, i) => ({ primary: i, baseline: n - i, actual: i }));
}

function identicalRows(n: number): readonly RankCorrelationDifferenceRow[] {
  return Array.from({ length: n }, (_, i) => ({ primary: i, baseline: i, actual: i }));
}

describe("bootstrapRankCorrelationDifference", () => {
  it("reads null when there are too few rows to correlate", () => {
    const result = bootstrapRankCorrelationDifference([{ primary: 1, baseline: 1, actual: 1 }], { seed: SEED });
    expect(result).toEqual({ primaryRho: null, baselineRho: null, difference: null, ci: null, beyondNoise: null, resamplesUsed: 0 });
  });

  it("reads null when one arm has zero variance (every player tied)", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ primary: i, baseline: 5, actual: i }));
    const result = bootstrapRankCorrelationDifference(rows, { seed: SEED });
    expect(result.baselineRho).toBeNull();
    expect(result.difference).toBeNull();
    expect(result.ci).toBeNull();
    expect(result.beyondNoise).toBeNull();
  });

  it("scores identical arms as exactly zero difference, not beyond noise", () => {
    const result = bootstrapRankCorrelationDifference(identicalRows(30), { seed: SEED });
    expect(result.primaryRho).toBeCloseTo(1, 10);
    expect(result.baselineRho).toBeCloseTo(1, 10);
    expect(result.difference).toBeCloseTo(0, 10);
    expect(result.beyondNoise).toBe(false);
  });

  it("finds a large, real separation beyond noise", () => {
    const result = bootstrapRankCorrelationDifference(separatedRows(30), { seed: SEED });
    expect(result.primaryRho).toBeCloseTo(1, 10);
    expect(result.baselineRho).toBeCloseTo(-1, 10);
    expect(result.difference).toBeCloseTo(2, 10);
    expect(result.ci).not.toBeNull();
    const [low, high] = result.ci!;
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(0);
    expect(result.beyondNoise).toBe(true);
    expect(result.resamplesUsed).toBeGreaterThan(0);
  });

  it("is deterministic: the same rows and seed reproduce the identical interval", () => {
    const rows = separatedRows(15);
    const first = bootstrapRankCorrelationDifference(rows, { seed: SEED });
    const second = bootstrapRankCorrelationDifference(rows, { seed: SEED });
    expect(second).toEqual(first);
  });

  it("changing the seed can move the interval without moving the point-estimate difference", () => {
    const rows = separatedRows(15);
    const a = bootstrapRankCorrelationDifference(rows, { seed: SEED });
    const b = bootstrapRankCorrelationDifference(rows, { seed: SEED + 1 });
    expect(a.difference).toBe(b.difference);
    expect(a.primaryRho).toBe(b.primaryRho);
    expect(a.baselineRho).toBe(b.baselineRho);
  });

  it("honours a custom resample count", () => {
    const result = bootstrapRankCorrelationDifference(separatedRows(20), { seed: SEED, resamples: 50 });
    expect(result.resamplesUsed).toBeLessThanOrEqual(50);
    expect(result.resamplesUsed).toBeGreaterThan(0);
  });
});
