import { describe, expect, it } from "vitest";
import { MIN_POOL_FOR_TIERS, tierStanding, tiersOf } from "./tiers";

describe("tiersOf", () => {
  it("finds the break where a position falls away, and only that one", () => {
    expect(tiersOf([100, 98, 96, 94, 60, 58, 56])).toEqual([0, 0, 0, 0, 1, 1, 1]);
  });

  it("calls an evenly spaced pool one tier, because there is no cliff in it", () => {
    expect(tiersOf([100, 90, 80, 70, 60, 50])).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("is not fooled by the cliff being inside its own comparison set", () => {
    // A mean gap here is (2+2+2+2+80)/5 = 17.6, and 2.5x that is above the 80 it is meant to
    // catch, so a mean would report no cliff at all. The median gap is 2.
    expect(tiersOf([100, 98, 96, 94, 92, 12])).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it("declines to tier a pool too short to have a typical gap", () => {
    const short = [100, 40, 39, 38];
    expect(short.length).toBeLessThan(MIN_POOL_FOR_TIERS);
    expect(tiersOf(short)).toEqual([0, 0, 0, 0]);
  });

  it("invents no cliff when every player is identical", () => {
    expect(tiersOf([50, 50, 50, 50, 50, 50])).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("finds the break in a plateau, where the typical gap is nothing at all", () => {
    // One good man and then a flat field: the median gap is zero, so "several times typical"
    // would rule out the fifty-eight-point drop it exists to catch.
    expect(tiersOf([70, 12, 12, 12, 12, 12])).toEqual([0, 1, 1, 1, 1, 1]);
  });
});

describe("tierStanding", () => {
  const pool = [100, 98, 96, 94, 60, 58, 56];

  it("counts the men left before the drop and how far the drop is", () => {
    expect(tierStanding(pool, 2)).toEqual({ tier: 0, playersLeftInTier: 2, dropToNextTier: 34 });
    expect(tierStanding(pool, 3)).toEqual({ tier: 0, playersLeftInTier: 1, dropToNextTier: 34 });
  });

  it("reports no drop for the last tier, because there is nothing below it", () => {
    expect(tierStanding(pool, 6).dropToNextTier).toBe(0);
  });

  it("refuses an index nobody occupies", () => {
    expect(() => tierStanding(pool, 9)).toThrow(/9/);
  });
});
