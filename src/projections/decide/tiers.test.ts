import { describe, expect, it } from "vitest";
import { GAMES_PER_SEASON, TIER_BREAK_GAMES, TIER_SPAN_POINTS_PER_GAME, tierStanding, tiersOf } from "./tiers";

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
