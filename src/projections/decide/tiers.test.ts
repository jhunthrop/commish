import { describe, expect, it } from "vitest";
import { GAMES_PER_SEASON, isRealTierCliff, TIER_BREAK_GAMES, TIER_SPAN_POINTS_PER_GAME, tierStanding, tiersOf } from "./tiers";

/** The live board on 2026-09-05 (12-team standard shape), the values the founder shaped the rule against. */
const RB_2026 = [262.1, 261.4, 245.4, 235.7, 224.2, 221.0, 217.7, 214.4, 213.3, 212.4, 191.5, 187.4, 183.1, 167.6, 166.3, 164.1, 163.2, 157.3, 154.7, 147.9, 139.8, 137.9, 136.6];
const WR_2026 = [334.2, 316.5, 293.9, 278.6, 276.5, 262.9, 260.0, 257.9, 256.0, 246.5, 236.0, 235.1, 232.5, 227.8];
const QB_2026 = [291.5, 268.4, 258.1, 257.9, 253.7, 249.2, 243.8, 241.3, 239.9, 237.7, 237.5];
const TE_2026 = [215.2, 213.8, 165.3, 162.5, 150.1, 148.6, 147.1, 146.6, 142.4, 138.4, 136.1];

const tierSizes = (tiers: readonly number[]): number[] =>
  tiers.reduce<number[]>((sizes, tier) => {
    const next = [...sizes];
    next[tier] = (next[tier] ?? 0) + 1;
    return next;
  }, []);

const widestSpan = (pointsDescending: readonly number[], tiers: readonly number[]): number =>
  Math.max(...tiers.map((tier) => pointsDescending[tiers.indexOf(tier)]! - pointsDescending[tiers.lastIndexOf(tier)]!));

describe("tiersOf", () => {
  it("draws the founder's running back sheet: two, then eight, then three (2026-09-05)", () => {
    // Gibbs and Robinson. Achane through Walker, with the 9.7 and 11.5 point steps inside the
    // tier. Hall, Love, Etienne. Then the ten below the 15.4 point drop before Kyren Williams.
    expect(tierSizes(tiersOf(RB_2026))).toEqual([2, 8, 3, 10]);
  });

  it("groups the receivers the same rule leaves apart under a fixed gap", () => {
    // Chase sits 17.7 points under Nacua, a bigger gap than the 16.0 that separates Achane from
    // Robinson, and belongs WITH Nacua: receivers score more, so the same drop is a smaller share
    // of a season. Smith-Njigba, St. Brown, Lamb. Jefferson through Brown. Collins through McMillan.
    expect(tierSizes(tiersOf(WR_2026))).toEqual([2, 3, 5, 4]);
  });

  it("leaves Allen alone when he is a game's worth clear of the field", () => {
    expect(tierSizes(tiersOf(QB_2026))).toEqual([1, 10]);
  });

  it("splits the tight ends at the two real drops and nowhere else", () => {
    expect(tierSizes(tiersOf(TE_2026))).toEqual([2, 2, 7]);
  });

  it("breaks exactly at a full game's worth of production", () => {
    const onTheLine = 100 * (1 - TIER_BREAK_GAMES / GAMES_PER_SEASON);
    expect(tiersOf([100, onTheLine - 0.05])).toEqual([0, 1]);
    expect(tiersOf([100, onTheLine + 0.05])).toEqual([0, 0]);
  });

  it("never lets one tier stretch more than the span cap, splitting a smooth run at its widest gaps", () => {
    const smooth = Array.from({ length: 30 }, (_, index) => 300 - index * 3);
    const tiers = tiersOf(smooth);
    expect(widestSpan(smooth, tiers)).toBeLessThanOrEqual(TIER_SPAN_POINTS_PER_GAME * GAMES_PER_SEASON);
    // Three points a step never reaches a game's worth, so only the cap is at work: 87 points of
    // run does not fit in two tiers of 34, and fits in three (ten men, 27 points each).
    expect(Math.max(...tiers)).toBe(2);
  });

  it("cuts a capped run on its widest gaps, never on a narrow one merely to save a tier", () => {
    // Smith-Njigba through McMillan: no step is a game's worth, the run is 66 points wide. Two
    // tiers COULD fit under the cap by cutting between Jefferson and London (a 2.9 point step);
    // the rule cuts on the 13.7 after Lamb and the 10.5 after Brown instead, and takes three.
    const run = [293.9, 278.6, 276.5, 262.9, 260.0, 257.9, 256.0, 246.5, 236.0, 235.1, 232.5, 227.8];
    expect(tierSizes(tiersOf(run))).toEqual([3, 5, 4]);
  });

  it("finds the break in a plateau, where the typical gap is nothing at all", () => {
    expect(tiersOf([70, 12, 12, 12, 12, 12])).toEqual([0, 1, 1, 1, 1, 1]);
  });

  it("invents no break when every player is identical", () => {
    expect(tiersOf([50, 50, 50, 50, 50, 50])).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("tiers a short pool honestly, because the rule needs no population to compare against", () => {
    expect(tiersOf([100, 40, 39])).toEqual([0, 1, 1]);
    expect(tiersOf([100])).toEqual([0]);
    expect(tiersOf([])).toEqual([]);
  });

  it("reads a non-positive projection above as no break, never as a division by nothing", () => {
    expect(tiersOf([0, 0, -3])).toEqual([0, 0, 0]);
  });
});

/**
 * THE OVERALL LADDER (the Draft area round, 2026-09-12, founder amendment 1) — the same rule run
 * across positions, on the key the board is ordered by rather than inside one pool. The fixture is
 * the product's own 2026 PPR board, 12-team standard shape, exported from the dev database on
 * 2026-09-12 (`scripts/rankings-export.ts --format=ppr`): every player it prices above replacement,
 * in board order, his points over replacement and his projected points.
 */
const OVERALL_VALUE_2026 = [
  162.8, 147.9, 128.6, 115.1, 113.3, 112.1, 108, 97.8, 93.7, 88.5, 88.3, 88.1, 87.1, 83.5, 75.2, 74.4, 72.9, 72.9,
  70.7, 69.9, 69.8, 69.5, 68.6, 66, 64.3, 59.9, 56.1, 53.1, 47.9, 47.7, 47.4, 45.3, 45.1, 44.2, 43.3, 42.9, 40.9,
  37, 35.4, 34, 27.4, 26.5, 25.2, 24.6, 24, 22.6, 22.5, 21, 19.9, 19.1, 19, 18.6, 18.5, 18.1, 18, 16.9, 15.3, 15.2,
  13.9, 10.3, 9.5, 9.4, 8.1, 7.6, 7.4, 6.8, 6.4, 6.1, 3.6, 3, 2.9, 2.6, 2.2, 2, 1.6, 1.5, 1.3, 1.3, 0.4, 0.2,
];
const OVERALL_POINTS_2026 = [
  344.3, 329.4, 310.1, 257.2, 255.5, 293.6, 289.5, 240, 275.2, 270, 269.8, 230.3, 268.5, 225.7, 217.3, 214.3,
  212.8, 254.3, 252.2, 251.3, 211.9, 211.7, 210.8, 208.1, 245.8, 241.4, 306.8, 234.6, 298.5, 189.9, 228.9, 187.5,
  187.3, 225.7, 224.8, 224.4, 222.4, 287.6, 216.9, 176.1, 278, 208, 275.8, 164.5, 205.4, 162.5, 204, 163.2, 201.4,
  269.7, 161.2, 160.8, 160.7, 268.7, 199.4, 267.5, 196.8, 157.3, 156.1, 152.4, 149.4, 190.9, 148, 189.1, 258,
  146.6, 257, 146, 185.1, 145.2, 184.4, 142.4, 252.9, 183.5, 183.1, 141.4, 141.2, 143.4, 181.9, 181.7,
];

describe("tiersOf across positions, on the real 2026 board", () => {
  it("draws no tier of one, which is the whole reason the denominator is production", () => {
    const sizes = tierSizes(tiersOf(OVERALL_VALUE_2026, OVERALL_POINTS_2026));
    expect(sizes).toHaveLength(7);
    expect(sizes.filter((size) => size === 1)).toEqual([]);
    // Nacua and Chase alone at the top, then the five behind them, and the ladder widens as the
    // board flattens: the shape a manager draws on paper.
    expect(sizes).toEqual([2, 5, 7, 12, 14, 19, 21]);
  });

  it("cuts the whole board into tiers of one when the break is read against the key instead", () => {
    // The rule the position pools keep, applied to the ranking key with no production behind it:
    // points over replacement runs to nothing at the tail, so an ordinary step near the bottom
    // reads as a cliff. This is the failure the second argument exists to prevent, pinned so a
    // later reader cannot quietly collapse the two.
    const sizes = tierSizes(tiersOf(OVERALL_VALUE_2026));
    expect(sizes.filter((size) => size === 1).length).toBeGreaterThan(10);
  });

  /**
   * L1 (fix round 1): the old version of this test asserted `tiersOf(x, x) === tiersOf(x)`, which
   * is true by the parameter's own default and proved nothing. What actually needs pinning is
   * that the SECOND argument is the denominator and the FIRST is the step — so the same key can
   * tier two ways depending on what the men behind it are projected to produce.
   */
  it("reads the break against production, so the same key tiers two ways", () => {
    // A ten point step. Behind a 170 point season that is a game's worth (10 >= 170/17) and the
    // tier breaks; behind a 340 point season it is half of one (10 < 20) and it does not.
    expect(tiersOf([100, 90], [170, 170])).toEqual([0, 1]);
    expect(tiersOf([100, 90], [340, 340])).toEqual([0, 0]);
  });

  it("defaults the denominator to the key, which is what a position pool passes", () => {
    // Stated once, here, rather than asserted at every position fixture above: a pool hands over
    // its projected points and gets the rule it has always had.
    expect(tiersOf(RB_2026)).toEqual(tiersOf(RB_2026, RB_2026));
  });

  it("keeps the span cap on the key the reader is looking at", () => {
    const tiers = tiersOf(OVERALL_VALUE_2026, OVERALL_POINTS_2026);
    expect(widestSpan(OVERALL_VALUE_2026, tiers)).toBeLessThanOrEqual(TIER_SPAN_POINTS_PER_GAME * GAMES_PER_SEASON);
  });

  it("runs the tiers contiguously down the order, so a band never reopens below itself", () => {
    const tiers = tiersOf(OVERALL_VALUE_2026, OVERALL_POINTS_2026);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
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

describe("isRealTierCliff", () => {
  it("calls a drop of a full game's worth of his own projection a cliff", () => {
    // 238 projected, a game's worth is 14.0.
    expect(isRealTierCliff(238, 14)).toBe(true);
    expect(isRealTierCliff(238, 20.9)).toBe(true);
  });

  it("declines a within-tier-sized step, however real the tier boundary above it", () => {
    // The founder's own case: a 3.2 point step behind a 238 point back is not a cliff.
    expect(isRealTierCliff(238, 3.2)).toBe(false);
    expect(isRealTierCliff(238, 13.9)).toBe(false);
  });

  it("declines a non-positive projection rather than dividing by nothing", () => {
    expect(isRealTierCliff(0, 40)).toBe(false);
    expect(isRealTierCliff(-3, 40)).toBe(false);
  });

  it("declines the last tier, which has no drop at all", () => {
    expect(isRealTierCliff(238, 0)).toBe(false);
  });

  it("is the same share the tier rule itself is drawn with", () => {
    const points = 170;
    const gamesWorth = (points * TIER_BREAK_GAMES) / GAMES_PER_SEASON;
    expect(isRealTierCliff(points, gamesWorth)).toBe(true);
    expect(isRealTierCliff(points, gamesWorth - 0.01)).toBe(false);
  });
});
