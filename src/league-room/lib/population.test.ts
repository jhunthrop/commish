import { describe, expect, it } from "vitest";
import type { MatchupDetail, MatchupLineupEntry } from "../contract";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { POSITION_POPULATION, comparisonWithin, percentileWithin, starterComparison, startedPointsByPosition } from "./population";

/**
 * THE POPULATION IS THE WHOLE POINT (`docs/design/2026-08-27-fun-pass-spec.md`, rule 1's
 * magnitude amendment): a number may be coloured only "where the comparison is genuine and
 * stated — a percentile within a defined population, never a designer's feeling about whether
 * 14.2 is a good number." `Stat` refuses to tint without one; this module is what builds the ones
 * the season surfaces have, out of numbers those surfaces already hold.
 */

const entry = (overrides: Partial<MatchupLineupEntry>): MatchupLineupEntry => ({
  slot: "QB",
  slotIndex: 0,
  playerId: "p1",
  playerName: "A Passer",
  position: "QB",
  points: 10,
  ...overrides,
});

const matchup = (starters: readonly MatchupLineupEntry[], bench: readonly MatchupLineupEntry[] = []): MatchupDetail => ({
  weekNumber: 1,
  home: { teamId: "h", teamName: "Home", score: 100, starters, bench },
  away: { teamId: "a", teamName: "Away", score: 90, starters: [], bench: [] },
  final: false,
  weekStatus: "in_progress",
  median: null,
});

describe("percentileWithin", () => {
  it("places a value by how much of its own population it beats", () => {
    // Percentile RANK, ties split: (below + half the ties) / total. The value is a member of
    // its own population, so the best number in a set of four lands at 0.875, never at 1.0 —
    // "top of this week" is not the same claim as "perfect", and the ramp should not read it as
    // one.
    expect(percentileWithin([1, 2, 3, 4], 4)).toBeCloseTo(0.875);
    expect(percentileWithin([1, 2, 3, 4], 1)).toBeCloseTo(0.125);
    expect(percentileWithin([1, 2, 3, 4], 3)).toBeCloseTo(0.625);
  });

  it("splits ties down the middle, so identical numbers never rank each other", () => {
    expect(percentileWithin([5, 5, 5, 5], 5)).toBeCloseTo(0.5);
  });

  it("answers 0.5 for an empty population rather than dividing by nothing", () => {
    // Defensive: `comparisonWithin` below is what actually refuses a population too small to
    // mean anything. This function simply never returns NaN, which would tint on a caller bug.
    expect(percentileWithin([], 4)).toBe(0.5);
  });
});

describe("comparisonWithin", () => {
  const population = "starting quarterbacks this week";

  it("names the population it compared against, in the words a manager would use", () => {
    const comparison = comparisonWithin([1, 2, 3, 4, 20], 20, population);
    expect(comparison).not.toBeUndefined();
    expect(comparison!.population).toBe(population);
    expect(comparison!.percentile).toBeCloseTo(0.9);
  });

  it("refuses a population too small to rank inside", () => {
    // Three scored quarterbacks is not "the league this week", it is three quarterbacks. A
    // percentile computed across them would be arithmetic dressed as a fact, which is precisely
    // what the amendment forbids — so the caller gets `undefined` and `Stat` renders plain ink.
    const tooFew = new Array(LEAGUE_ROOM_CONFIG.heatMinPopulation - 1).fill(10);
    expect(comparisonWithin(tooFew, 10, population)).toBeUndefined();
    const enough = new Array(LEAGUE_ROOM_CONFIG.heatMinPopulation).fill(10);
    expect(comparisonWithin(enough, 10, population)).not.toBeUndefined();
  });

  it("inverts the ramp for a number that is better when it is smaller", () => {
    // Points against is the standings' one column where the biggest number is the worst one.
    // The population is named for the direction ("teams by fewest points allowed") so the
    // sentence `Stat` speaks stays true rather than merely grammatical.
    const allowed = [80, 90, 100, 110, 200];
    const worst = comparisonWithin(allowed, 200, "teams by fewest points allowed", "lower-is-better");
    expect(worst!.percentile).toBeCloseTo(0.1);
    const best = comparisonWithin(allowed, 80, "teams by fewest points allowed", "lower-is-better");
    expect(best!.percentile).toBeCloseTo(0.9);
  });

  it("refuses a value that is not a real number", () => {
    expect(comparisonWithin([1, 2, 3, 4, 5], Number.NaN, population)).toBeUndefined();
  });
});

describe("startedPointsByPosition", () => {
  it("pools the week's STARTERS by position, because a bench player never scored for anyone", () => {
    const pool = startedPointsByPosition([
      matchup(
        [entry({ points: 12 }), entry({ position: "RB", slot: "RB", points: 8 })],
        [entry({ position: "RB", slot: "BENCH", points: 99 })],
      ),
    ]);
    expect(pool.get("QB")).toEqual([12]);
    expect(pool.get("RB")).toEqual([8]);
  });

  it("leaves out a player who has not played yet, because a dash is not a zero", () => {
    // `MatchupLineupEntry.points === null` means no stat line yet. Folding it in as a zero
    // would drag every real score up the ramp on a Sunday morning.
    const pool = startedPointsByPosition([matchup([entry({ points: null }), entry({ points: 20 })])]);
    expect(pool.get("QB")).toEqual([20]);
  });

  it("leaves out an empty roster slot, which has no position to pool it under", () => {
    const pool = startedPointsByPosition([matchup([entry({ playerId: null, playerName: null, position: null, points: null })])]);
    expect(pool.size).toBe(0);
  });

  it("pools BOTH sides of every matchup in the week, which is what makes it a league population", () => {
    const both: MatchupDetail = {
      ...matchup([entry({ points: 12 })]),
      away: { teamId: "a", teamName: "Away", score: 90, starters: [entry({ points: 30 })], bench: [] },
    };
    expect(startedPointsByPosition([both]).get("QB")).toEqual([12, 30]);
  });
});

describe("starterComparison", () => {
  const pool = startedPointsByPosition([
    matchup([
      entry({ points: 4 }),
      entry({ points: 8 }),
      entry({ points: 12 }),
      entry({ points: 16 }),
      entry({ points: 30 }),
    ]),
  ]);

  it("compares a starter against the players who share their job", () => {
    const comparison = starterComparison(pool, "QB", 30);
    expect(comparison!.population).toBe(POSITION_POPULATION.QB);
    expect(comparison!.percentile).toBeCloseTo(0.9);
  });

  it("has nothing to say about a player with no position or no stat line", () => {
    expect(starterComparison(pool, null, 30)).toBeUndefined();
    expect(starterComparison(pool, "QB", null)).toBeUndefined();
  });

  it("has nothing to say about a position nobody in the week has started", () => {
    expect(starterComparison(pool, "K", 9)).toBeUndefined();
  });
});
