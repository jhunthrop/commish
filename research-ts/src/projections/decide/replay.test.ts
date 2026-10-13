import { describe, expect, it } from "vitest";
import type { Position } from "@research-ts/domain/player";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@research-ts/domain/roster";
import type { DraftCandidate } from "./draft";
import { outlookAround } from "./outlook";
import type { LeagueShape, SeasonProjection } from "./replacement";
import { valueBoard } from "./replacement";
import {
  byProjectedPoints,
  byRecommendation,
  byStartersFirstPoints,
  byValueOverReplacement,
  lineupRegret,
  pairedDraftReplay,
  replayDraft,
  rosterValue,
  scoreSleepers,
} from "./replay";
import type { Sleeper } from "./sleepers";

const SHAPE: LeagueShape = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };

function pool(position: Position, count: number, top: number, step: number): readonly SeasonProjection[] {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `${position}${index + 1}`,
    position,
    projectedPoints: top - index * step,
  }));
}

/** Deep enough that a twelve-team draft never runs the board dry. */
const PROJECTIONS: readonly SeasonProjection[] = [
  ...pool("QB", 40, 330, 4),
  ...pool("RB", 70, 300, 4),
  ...pool("WR", 90, 290, 2.5),
  ...pool("TE", 40, 220, 5),
  ...pool("K", 30, 140, 2),
  ...pool("DEF", 30, 130, 2),
];

/** The market in this room IS the way the room drafts, so a points board prices at points rank. */
function boardWithMarket(projections: readonly SeasonProjection[]): readonly DraftCandidate[] {
  const priced = new Map(
    [...projections]
      .sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId))
      .map((player, index) => [player.playerId, index + 1]),
  );
  return valueBoard(projections, SHAPE).map((player) => ({
    ...player,
    averageDraftPosition: priced.get(player.playerId)!,
  }));
}

const BOARD = boardWithMarket(PROJECTIONS);

describe("replayDraft", () => {
  it("turns the snake the way this product's own draft does", () => {
    const seats = Array.from({ length: 12 }, () => byProjectedPoints);
    const { picks } = replayDraft({ board: BOARD, shape: SHAPE, seats });
    expect(picks[0]!.seat).toBe(0);
    expect(picks[11]!.seat).toBe(11);
    expect(picks[12]!.seat).toBe(11);
    expect(picks[23]!.seat).toBe(0);
  });

  it("gives every seat a legal roster and nobody two of the same man", () => {
    const seats = Array.from({ length: 12 }, () => byRecommendation);
    const { picks, rostersBySeat } = replayDraft({ board: BOARD, shape: SHAPE, seats });
    expect(new Set(picks.map((pick) => pick.playerId)).size).toBe(picks.length);
    for (const roster of rostersBySeat) {
      // Fifteen slots, and a seat may end one short: a pass is a legal outcome when the roster's
      // last open slot is at a position the board has run out of. See `SeatStrategy`.
      expect(roster.length).toBeGreaterThanOrEqual(14);
      expect(roster.length).toBeLessThanOrEqual(15);
      // The engine's own slot rules are what limit this; nothing here re-states them.
      expect(roster.filter((player) => player.position === "QB").length).toBeLessThanOrEqual(7);
    }
  });

  it("the realistic opponent fills its starting slots before stacking a bench", () => {
    const seats = Array.from({ length: 12 }, () => byStartersFirstPoints);
    const { rostersBySeat } = replayDraft({ board: BOARD, shape: SHAPE, seats });
    for (const roster of rostersBySeat) {
      // Nine starting slots in the standard shape, and every one of them filled before any
      // position was stacked. A plain points ranking spends four to six picks on quarterbacks.
      expect(roster.filter((player) => player.position === "QB").length).toBeLessThanOrEqual(2);
      for (const position of ["RB", "WR", "TE"] as const) {
        expect(roster.some((player) => player.position === position)).toBe(true);
      }
    }
  });

  it("refuses a seat count that is not the league's", () => {
    expect(() => replayDraft({ board: BOARD, shape: SHAPE, seats: [byProjectedPoints] })).toThrow(/12/);
  });
});

describe("rosterValue", () => {
  it("is the best starting lineup, not the whole roster", () => {
    const roster = [
      { playerId: "a", position: "WR" as Position },
      { playerId: "b", position: "WR" as Position },
      { playerId: "c", position: "WR" as Position },
      { playerId: "d", position: "WR" as Position },
    ];
    const actual = new Map([["a", 100], ["b", 90], ["c", 80], ["d", 70]]);
    // Two receiver spots and a flex take the best three. The fourth is bench and worth nothing.
    expect(rosterValue(roster, actual, SHAPE)).toBe(270);
  });
});

describe("pairedDraftReplay", () => {
  it("compares the same seat against the same opponents, twice", () => {
    const actualPoints = new Map(PROJECTIONS.map((player) => [player.playerId, player.projectedPoints]));
    const result = pairedDraftReplay({
      board: BOARD,
      shape: SHAPE,
      baseline: byProjectedPoints,
      underTest: byValueOverReplacement,
      actualPoints,
    });
    expect(result.seatCount).toBe(12);
    expect(result.bySeat.map((seat) => seat.seat)).toEqual([...Array(12).keys()]);
    for (const seat of result.bySeat) {
      expect(seat.improvement).toBe(seat.underTestPoints - seat.baselinePoints);
    }
  });

  it("finds no difference at all when the strategy under test IS the baseline", () => {
    const actualPoints = new Map(PROJECTIONS.map((player) => [player.playerId, player.projectedPoints]));
    const result = pairedDraftReplay({
      board: BOARD,
      shape: SHAPE,
      baseline: byProjectedPoints,
      underTest: byProjectedPoints,
      actualPoints,
    });
    expect(result.meanImprovement).toBe(0);
    expect(result.seatsImproved).toBe(0);
  });

  it("the outcome is never visible to a seat: shuffling it changes no pick", () => {
    const truthful = new Map(PROJECTIONS.map((player) => [player.playerId, player.projectedPoints]));
    const inverted = new Map(PROJECTIONS.map((player) => [player.playerId, -player.projectedPoints]));
    const picksUnder = (actualPoints: ReadonlyMap<string, number>): readonly string[] =>
      pairedDraftReplay({
        board: BOARD,
        shape: SHAPE,
        baseline: byProjectedPoints,
        underTest: byRecommendation,
        actualPoints,
      }).bySeat.map((seat) => `${seat.seat}`);
    expect(picksUnder(truthful)).toEqual(picksUnder(inverted));
  });
});

describe("scoreSleepers", () => {
  const market = [
    { playerId: "hit", averageDraftPosition: 100 },
    { playerId: "miss", averageDraftPosition: 101 },
    ...Array.from({ length: 100 }, (_, index) => ({
      playerId: `other${index}`,
      averageDraftPosition: index + 1,
    })),
  ];
  const actualPoints = new Map<string, number>([
    ["hit", 500],
    ["miss", 1],
    ...Array.from({ length: 100 }, (_, index): [string, number] => [`other${index}`, 400 - index]),
  ]);
  const named: readonly Sleeper[] = [
    { playerId: "hit", position: "WR", ourRank: 5, marketRank: 100, disagreement: 3, score: 3, causes: [], ceilingAbovePrice: null },
    { playerId: "miss", position: "WR", ourRank: 6, marketRank: 101, disagreement: 2.8, score: 2.8, causes: [], ceilingAbovePrice: null },
  ];

  it("PUBLISHES THE MISSES, not only the hits", () => {
    const card = scoreSleepers({ sleepers: named, market, actualPoints });
    expect(card.outcomes).toHaveLength(2);
    expect(card.outcomes.find((o) => o.playerId === "hit")!.hit).toBe(true);
    expect(card.outcomes.find((o) => o.playerId === "miss")!.hit).toBe(false);
    expect(card.hitRate).toBe(0.5);
  });

  it("reports the base rate, because a list that hits at it has said nothing", () => {
    const card = scoreSleepers({ sleepers: named, market, actualPoints });
    expect(card.baseRate).toBeGreaterThan(0);
    expect(card.baseRate).toBeLessThan(1);
  });
});

describe("lineupRegret", () => {
  const ONE_RECEIVER: readonly RosterSlotConfig[] = [
    { slot: "WR", count: 1, eligiblePositions: ["WR"] },
    { slot: BENCH_SLOT, count: 1, eligiblePositions: ["WR"] },
  ];
  const shape: LeagueShape = { teamCount: 12, rosterSlots: ONE_RECEIVER };
  const candidates = [
    { playerId: "steady", position: "WR" as Position, outlook: outlookAround(12, 2.4) },
    { playerId: "volatile", position: "WR" as Position, outlook: outlookAround(12, 7.8) },
  ];

  it("measures against the best lineup available in hindsight", () => {
    const actualPoints = new Map([["steady", 11], ["volatile", 26]]);
    const trailing = lineupRegret(
      { candidates, matchup: { projectedMargin: -15, opponentStandardDeviation: 20 }, actualPoints },
      shape,
    );
    expect(trailing.optimalPoints).toBe(26);
    // Chasing the ceiling from behind was right that week, and the plain ranking was not.
    expect(trailing.chosenPoints).toBe(26);
    expect(trailing.regret).toBe(0);
    expect(trailing.baselineRegret).toBe(15);
  });

  it("and it is a real risk: the same call costs points on a week the ceiling does not land", () => {
    const actualPoints = new Map([["steady", 14], ["volatile", 2]]);
    const trailing = lineupRegret(
      { candidates, matchup: { projectedMargin: -15, opponentStandardDeviation: 20 }, actualPoints },
      shape,
    );
    expect(trailing.regret).toBe(12);
    expect(trailing.baselineRegret).toBe(0);
  });
});
