import { describe, expect, it } from "vitest";
import { shrinkTowardMarket, THIN_EVIDENCE_PRIOR_N } from "./thin-evidence-shrink";

describe("shrinkTowardMarket", () => {
  it("shrinks nowhere when there is no market listing — the null cell, exactly", () => {
    expect(shrinkTowardMarket(254.7, null, 0)).toBe(254.7);
    expect(shrinkTowardMarket(254.7, null, 1000)).toBe(254.7);
  });

  it("moves SUBSTANTIALLY toward market on razor-thin evidence (n around 1-2)", () => {
    const result = shrinkTowardMarket(254.7, 175, 1.5);
    // weight = 3 / (3 + 1.5) = 2/3 — the model's own number counts for a third, the market for two.
    expect(result).toBeCloseTo(254.7 * (1 / 3) + 175 * (2 / 3), 6);
    expect(result).toBeLessThan(254.7);
    expect(result).toBeGreaterThan(175);
  });

  it("moves almost NOT AT ALL for a well-evidenced player (large n) — a veteran's full history", () => {
    const result = shrinkTowardMarket(300, 250, 200);
    expect(Math.abs(result - 300)).toBeLessThan(1);
  });

  it("is a strictly decreasing weight in n — more evidence never increases how far a player moves", () => {
    const distanceAt = (n: number): number => Math.abs(shrinkTowardMarket(300, 100, n) - 300);
    const ns = [0, 1, 2, 5, 10, 50, 500];
    for (let index = 1; index < ns.length; index += 1) {
      expect(distanceAt(ns[index]!)).toBeLessThan(distanceAt(ns[index - 1]!));
    }
  });

  it("never produces a result outside the [model, market] interval", () => {
    for (const n of [0, 1, 3, 10, 100]) {
      const result = shrinkTowardMarket(400, 100, n);
      expect(result).toBeGreaterThanOrEqual(100);
      expect(result).toBeLessThanOrEqual(400);
    }
  });

  it("defaults to the committed THIN_EVIDENCE_PRIOR_N", () => {
    expect(shrinkTowardMarket(200, 100, 5)).toBeCloseTo(
      200 * (1 - THIN_EVIDENCE_PRIOR_N / (THIN_EVIDENCE_PRIOR_N + 5)) + 100 * (THIN_EVIDENCE_PRIOR_N / (THIN_EVIDENCE_PRIOR_N + 5)),
      10,
    );
  });

  it("refuses a non-positive priorN", () => {
    expect(() => shrinkTowardMarket(200, 100, 5, 0)).toThrow(/positive finite/);
    expect(() => shrinkTowardMarket(200, 100, 5, -1)).toThrow(/positive finite/);
  });

  it("treats a negative effectiveN as zero rather than inverting the shrink", () => {
    expect(shrinkTowardMarket(200, 100, -5)).toBeCloseTo(shrinkTowardMarket(200, 100, 0), 10);
  });
});
