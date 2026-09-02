import { describe, expect, it } from "vitest";
import type { StatLine } from "@/domain/player";
import type { Law } from "../laws/types";
import type { BoardCandidate, BoardReason } from "../preseason/board";
import { rookieCurve } from "../preseason/rookie-curve";
import type { MarketPriorEntry } from "./curve";
import {
  assertLiveMarketCoverage,
  BLEND_TRAIN_CUTOFF_SEASON,
  blendBoard,
  detectPlateau,
  fitMarketTailByPosition,
  MINIMUM_LISTED_PER_POSITION,
  seasonPointsOf,
  scoreBlendConstants,
  withLawsAblated,
  type BlendConstants,
  type BlendTrainRow,
} from "./blend";

const SEASON = 2020;
/** The market's own fitted implied games played, per position — deliberately NOT `teamGamesIn`'s
 *  16/17: I3+I5 fix round retired that denominator in favour of this one. A single flat number
 *  across every position keeps most tests focused on one axis at a time. */
const IMPLIED_GAMES = 14;

/** Set far above anything a test's raw points could reach, so the structural tail guard
 *  (`tailCappedUnlistedPoints`'s own `Math.min`) never silently interferes with a test that is not
 *  specifically exercising it — a test that DOES want the guard overrides this per-position. */
const NO_TAIL = 100_000;

/** Small, easy-to-reason-about constants — never the committed fit, so a test never breaks
 *  silently when the real grid search re-fits. */
const CONSTANTS: BlendConstants = {
  lawCapPoints: 20,
  availabilityCapPoints: 40,
  totalCapPoints: 50,
  impliedGamesByPosition: { QB: IMPLIED_GAMES, RB: IMPLIED_GAMES, WR: IMPLIED_GAMES, TE: IMPLIED_GAMES },
  marketTailByPosition: { QB: NO_TAIL, RB: NO_TAIL, WR: NO_TAIL, TE: NO_TAIL },
};

function line(overrides: Partial<StatLine> = {}): StatLine {
  return {
    playerId: "player-1",
    week: 1,
    passingYards: 0,
    passingTouchdowns: 0,
    interceptions: 0,
    rushingYards: 0,
    rushingTouchdowns: 0,
    receivingYards: 20,
    receivingTouchdowns: 0,
    receptions: 0,
    fumblesLost: 0,
    fieldGoalsMade: 0,
    extraPointsMade: 0,
    sacks: 0,
    defensiveInterceptions: 0,
    defensiveTouchdowns: 0,
    ...overrides,
  };
}

function candidate(overrides: Partial<BoardCandidate> = {}): BoardCandidate {
  return {
    playerId: "player-1",
    position: "RB",
    team: "KC",
    perGame: line(),
    games: {
      expected: IMPLIED_GAMES,
      rate: 1,
      distribution: { floor: IMPLIED_GAMES, median: IMPLIED_GAMES, ceiling: IMPLIED_GAMES },
      probabilities: [],
    },
    reasons: [],
    ...overrides,
  };
}

function market(overrides: Partial<MarketPriorEntry> = {}): MarketPriorEntry {
  return { playerId: "player-1", position: "RB", adpRank: 10, marketPoints: 220, ...overrides };
}

/** A confirmed law entry — `trainEffect` deliberately DIFFERENT from `measured.effect` (999 vs. a
 *  small real number) in every test that admits a law's delta, so a blend that accidentally read
 *  the full-window `effect` instead of `trainEffect` (the exact C1 leak this fix round closes)
 *  would produce a wildly different, easily distinguishable number rather than passing by luck. */
function lawFixture(overrides: Partial<Law> = {}): Law {
  return {
    id: "rb_workload_cliff",
    position: "RB",
    claim: "Fixture claim, independent of the real registry.",
    measured: { effect: 999, ci: [-1, 1], sample: 100, seasons: "fixture" },
    trainEffect: 2,
    verdict: "confirmed",
    modelPath: null,
    hasFoldEvidence: true,
    origin: "tribal",
    primaryQuantityId: null,
    primaryQuantityNoun: null,
    primaryQuantityUnit: null,
    ...overrides,
  };
}

function lawReason(overrides: Partial<Extract<BoardReason, { code: "law" }>> = {}): BoardReason {
  return { code: "law", lawId: "rb_workload_cliff", effect: 999, magnitude: 300, ...overrides };
}

describe("blendBoard", () => {
  it("PIN: a player with no admitted evidence gets marketPoints EXACTLY — the identity the whole design rests on", () => {
    const [blended] = blendBoard([market({ marketPoints: 233.47 })], [candidate()], { season: SEASON, constants: CONSTANTS, laws: [] });
    expect(seasonPointsOf(blended!)).toBeCloseTo(233.47, 6);
    expect(blended!.reasons).toContainEqual({ code: "market_anchor", marketPoints: 233.47, delta: 0 });
  });

  it("admits a single law's delta off its TRAIN-ONLY effect, never the full-window one (C1 fix round)", () => {
    const cheapCap: BlendConstants = { ...CONSTANTS, lawCapPoints: 100, totalCapPoints: 100 };
    const withLaw = candidate({ reasons: [lawReason()] });
    const laws = [lawFixture({ trainEffect: 2 })];
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withLaw], { season: SEASON, constants: cheapCap, laws });
    // trainEffect (2 pts/game) * expectedGames/17 — expectedGames === IMPLIED_GAMES (14).
    const expectedDelta = 2 * (IMPLIED_GAMES / 17);
    expect(seasonPointsOf(blended!)).toBeCloseTo(200 + expectedDelta, 2);
  });

  it("throws when a law reason fires but evidence.laws carries no matching entry — model/registry drift", () => {
    const withLaw = candidate({ reasons: [lawReason({ lawId: "not_in_registry" })] });
    expect(() => blendBoard([market()], [withLaw], { season: SEASON, constants: CONSTANTS, laws: [] })).toThrow(
      /"not_in_registry" fired a BoardReason but has no matching entry/,
    );
  });

  it("CAPS a single law's delta at lawCapPoints, regardless of how large the raw trainEffect is", () => {
    const tinyCap: BlendConstants = { ...CONSTANTS, lawCapPoints: 3, totalCapPoints: 100 };
    const withHugeLaw = candidate({ reasons: [lawReason()] });
    const laws = [lawFixture({ trainEffect: 500 })];
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withHugeLaw], { season: SEASON, constants: tinyCap, laws });
    expect(seasonPointsOf(blended!)).toBeCloseTo(203, 6);
  });

  it("CAPS the combined total delta at totalCapPoints even when several admitted deltas would sum higher", () => {
    const tinyTotal: BlendConstants = { ...CONSTANTS, lawCapPoints: 100, availabilityCapPoints: 100, totalCapPoints: 5 };
    const overExpected = candidate({ reasons: [lawReason()] });
    const laws = [lawFixture({ trainEffect: 50 })];
    const [blended] = blendBoard([market({ marketPoints: 200 })], [overExpected], { season: SEASON, constants: tinyTotal, laws });
    expect(seasonPointsOf(blended!)).toBeCloseTo(205, 6);
  });

  it("withLawsAblated forces the law delta to zero, functionally identical to no law firing at all (C1(ii))", () => {
    const withLaw = candidate({ reasons: [lawReason()] });
    const laws = [lawFixture({ trainEffect: 500 })];
    const [ablated] = blendBoard([market({ marketPoints: 200 })], [withLaw], {
      season: SEASON,
      constants: withLawsAblated(CONSTANTS),
      laws,
    });
    expect(seasonPointsOf(ablated!)).toBeCloseTo(200, 6);
  });

  it("admits a POSITIVE availability delta when expected games exceed the market's own implied games at that position", () => {
    const roomy: BlendConstants = { ...CONSTANTS, availabilityCapPoints: 100, totalCapPoints: 100 };
    const moreGames = candidate({
      games: { expected: IMPLIED_GAMES + 2, rate: 1, distribution: { floor: 0, median: 0, ceiling: 0 }, probabilities: [] },
    });
    const [blended] = blendBoard([market({ marketPoints: 200 })], [moreGames], { season: SEASON, constants: roomy, laws: [] });
    const expectedDelta = 2 * (200 / IMPLIED_GAMES);
    expect(seasonPointsOf(blended!)).toBeCloseTo(200 + expectedDelta, 2);
    expect(seasonPointsOf(blended!)).toBeGreaterThan(200);
  });

  it("admits a NEGATIVE availability delta when expected games fall short of the market's own implied games", () => {
    const roomy: BlendConstants = { ...CONSTANTS, availabilityCapPoints: 100, totalCapPoints: 100 };
    const fewerGames = candidate({
      games: { expected: IMPLIED_GAMES - 4, rate: 1, distribution: { floor: 0, median: 0, ceiling: 0 }, probabilities: [] },
    });
    const [blended] = blendBoard([market({ marketPoints: 200 })], [fewerGames], { season: SEASON, constants: roomy, laws: [] });
    const expectedDelta = -4 * (200 / IMPLIED_GAMES);
    expect(seasonPointsOf(blended!)).toBeCloseTo(200 + expectedDelta, 2);
    expect(seasonPointsOf(blended!)).toBeLessThan(200);
  });

  it("CAPS the availability delta at availabilityCapPoints", () => {
    const tinyAvailability: BlendConstants = { ...CONSTANTS, lawCapPoints: 100, availabilityCapPoints: 1, totalCapPoints: 100 };
    const fewerGames = candidate({
      games: { expected: 1, rate: 1, distribution: { floor: 0, median: 0, ceiling: 0 }, probabilities: [] },
    });
    const [blended] = blendBoard([market({ marketPoints: 200 })], [fewerGames], { season: SEASON, constants: tinyAvailability, laws: [] });
    expect(seasonPointsOf(blended!)).toBeCloseTo(199, 6);
  });

  it("throws for a candidate at a position the implied-games table carries no entry for", () => {
    const kicker = candidate({ position: "K" });
    expect(() => blendBoard([market({ position: "K" })], [kicker], { season: SEASON, constants: CONSTANTS, laws: [] })).toThrow(
      /no implied-games entry for position "K"/,
    );
  });

  it("M4 PIN: a candidate with zero expected games gets EXACTLY zero season points — the deliberate answer, not merely a non-negative one", () => {
    const permissive: BlendConstants = { ...CONSTANTS, lawCapPoints: 1000, availabilityCapPoints: 1000, totalCapPoints: 1000 };
    const neverPlays = candidate({
      games: { expected: 0, rate: 0, distribution: { floor: 0, median: 0, ceiling: 0 }, probabilities: [] },
    });
    const [blended] = blendBoard([market({ marketPoints: 5 })], [neverPlays], { season: SEASON, constants: permissive, laws: [] });
    expect(seasonPointsOf(blended!)).toBe(0);
  });

  it("REPLACES marketPoints with rookieCurve for a listed rookie, ignoring the market's own number entirely, and records the substitution as market_anchor", () => {
    const rookie = candidate({
      position: "WR",
      reasons: [{ code: "rookie", overallPick: 5, landingMultiplier: 1 }],
    });
    const [blended] = blendBoard([market({ marketPoints: 999 })], [rookie], { season: SEASON, constants: CONSTANTS, laws: [] });
    const curvePoints = rookieCurve("WR", 5);
    expect(seasonPointsOf(blended!)).toBeCloseTo(curvePoints, 6);
    expect(blended!.reasons).toContainEqual({ code: "market_anchor", marketPoints: 999, delta: curvePoints - 999 });
  });

  it("a rookie with no draft pick on record (overallPick null) is NOT substituted — falls through to the market/evidence path", () => {
    const undraftedRookie = candidate({ reasons: [{ code: "rookie", overallPick: null, landingMultiplier: 1 }] });
    const [blended] = blendBoard([market({ marketPoints: 200 })], [undraftedRookie], { season: SEASON, constants: CONSTANTS, laws: [] });
    expect(seasonPointsOf(blended!)).toBeCloseTo(200, 6);
  });

  it("FALLS BACK to the raw model points for a player absent from the market board, tagging the reason", () => {
    const raw = candidate({ perGame: line({ receivingYards: 50 }) });
    const rawSeasonPoints = seasonPointsOf(raw);
    const [blended] = blendBoard([], [raw], { season: SEASON, constants: CONSTANTS, laws: [] });
    expect(seasonPointsOf(blended!)).toBeCloseTo(rawSeasonPoints, 6);
    expect(blended!.reasons).toContainEqual({ code: "market_unlisted" });
    expect(blended!.reasons).not.toContainEqual(expect.objectContaining({ code: "market_anchor" }));
  });

  it("PIN (fix round 2, ruling 4a; SIMPLIFIED fix round 3, IMPORTANT 1): an unlisted candidate is NEVER priced above his position's own market tail, however high his raw points are", () => {
    const raw = candidate({ perGame: line({ receivingYards: 500 }) }); // an enormous raw number
    const constants: BlendConstants = {
      ...CONSTANTS,
      marketTailByPosition: { ...CONSTANTS.marketTailByPosition, RB: 51 }, // the real fitted RB tail is ~51
    };
    const [blended] = blendBoard([], [raw], { season: SEASON, constants, laws: [] });
    expect(seasonPointsOf(blended!)).toBeCloseTo(51, 2);
  });

  it("does NOT cap an unlisted candidate whose raw points already sit below the tail", () => {
    const raw = candidate({ perGame: line({ receivingYards: 5 }) }); // a modest raw number
    const constants: BlendConstants = { ...CONSTANTS, marketTailByPosition: { ...CONSTANTS.marketTailByPosition, RB: 51 } };
    const rawSeasonPoints = seasonPointsOf(raw);
    const [blended] = blendBoard([], [raw], { season: SEASON, constants, laws: [] });
    expect(seasonPointsOf(blended!)).toBeCloseTo(rawSeasonPoints, 6);
    expect(seasonPointsOf(blended!)).toBeLessThan(51);
  });

  it("ORDERING-PRESERVED PIN (fix round 3, IMPORTANT 1): two unlisted players keep their raw model's own order — the exact property the dead affine rescale erased by collapsing every unlisted candidate at a position to the identical tail value", () => {
    const strongerRaw = candidate({ playerId: "stronger", perGame: line({ playerId: "stronger", receivingYards: 40 }) });
    const weakerRaw = candidate({ playerId: "weaker", perGame: line({ playerId: "weaker", receivingYards: 10 }) });
    const strongerPoints = seasonPointsOf(strongerRaw);
    const weakerPoints = seasonPointsOf(weakerRaw);
    expect(strongerPoints).toBeGreaterThan(weakerPoints); // sanity: the fixtures really do differ

    const constants: BlendConstants = { ...CONSTANTS, marketTailByPosition: { ...CONSTANTS.marketTailByPosition, RB: 1000 } }; // above both raw values, so neither is capped
    const blended = blendBoard([], [strongerRaw, weakerRaw], { season: SEASON, constants, laws: [] });
    const stronger = blended.find((c) => c.playerId === "stronger")!;
    const weaker = blended.find((c) => c.playerId === "weaker")!;
    expect(seasonPointsOf(stronger)).toBeCloseTo(strongerPoints, 6);
    expect(seasonPointsOf(weaker)).toBeCloseTo(weakerPoints, 6);
    expect(seasonPointsOf(stronger)).toBeGreaterThan(seasonPointsOf(weaker));
  });

  it("carries every OTHER candidate's own fields through unchanged (team, position, games)", () => {
    const original = candidate({ team: "SF", position: "WR" });
    const [blended] = blendBoard([market({ marketPoints: 150, position: "WR" })], [original], { season: SEASON, constants: CONSTANTS, laws: [] });
    expect(blended!.team).toBe("SF");
    expect(blended!.position).toBe("WR");
    expect(blended!.games).toBe(original.games);
    expect(blended!.playerId).toBe("player-1");
  });

  it("blends every model candidate independently, keyed by playerId", () => {
    const a = candidate({ playerId: "a" });
    const b = candidate({ playerId: "b", perGame: line({ playerId: "b" }) });
    const marketA = market({ playerId: "a", marketPoints: 100 });
    const marketB = market({ playerId: "b", marketPoints: 300 });
    const blended = blendBoard([marketA, marketB], [a, b], { season: SEASON, constants: CONSTANTS, laws: [] });
    expect(blended).toHaveLength(2);
    expect(seasonPointsOf(blended.find((c) => c.playerId === "a")!)).toBeCloseTo(100, 6);
    expect(seasonPointsOf(blended.find((c) => c.playerId === "b")!)).toBeCloseTo(300, 6);
  });

  it("defaults evidence.laws to the real registry() when omitted, and does not throw", () => {
    expect(() => blendBoard([market({ marketPoints: 100 })], [candidate()], { season: SEASON, constants: CONSTANTS })).not.toThrow();
  });
});

/**
 * FIT-ROUND TASK 3, DELIVERABLE A — the pricing-admission gate. A law Task 2 marked SUSPECT keeps its
 * confirmed verdict, its board reason and its chip eligibility, and never moves a price.
 */
describe("blendBoard — the pricing-admission gate (fit-round Task 3, deliverable A)", () => {
  /** One of the nine, verbatim: the fullback-driven snap-share law (Task 2, vigilance A). */
  const SUSPECT_ID = "threshold:RB:snapShare:q20";

  const roomy: BlendConstants = { ...CONSTANTS, lawCapPoints: 100, totalCapPoints: 100 };

  it("a SUSPECT law yields NO pricing delta even though it is confirmed and fires a reason", () => {
    const withSuspect = candidate({ reasons: [lawReason({ lawId: SUSPECT_ID })] });
    const laws = [lawFixture({ id: SUSPECT_ID, origin: "discovered", verdict: "confirmed", trainEffect: 50 })];
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withSuspect], { season: SEASON, constants: roomy, laws });
    expect(seasonPointsOf(blended!)).toBeCloseTo(200, 6);
    expect(blended!.reasons).toContainEqual({ code: "market_anchor", marketPoints: 200, delta: 0 });
  });

  it("the same law with an ordinary id DOES move the price — the gate is the id, not the fixture", () => {
    const withOrdinary = candidate({ reasons: [lawReason({ lawId: "threshold:RB:snapShare:q70" })] });
    const laws = [lawFixture({ id: "threshold:RB:snapShare:q70", origin: "discovered", verdict: "confirmed", trainEffect: 50 })];
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withOrdinary], { season: SEASON, constants: roomy, laws });
    expect(seasonPointsOf(blended!)).toBeGreaterThan(200);
  });

  it("the suspect law's own board reason SURVIVES on the candidate — the chip surface still sees it", () => {
    const withSuspect = candidate({ reasons: [lawReason({ lawId: SUSPECT_ID })] });
    const laws = [lawFixture({ id: SUSPECT_ID, origin: "discovered", verdict: "confirmed", trainEffect: 50 })];
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withSuspect], { season: SEASON, constants: roomy, laws });
    expect(blended!.reasons).toContainEqual(lawReason({ lawId: SUSPECT_ID }));
    expect(laws[0]!.verdict).toBe("confirmed");
  });

  it("still throws for a law reason with NO registry entry — gating is not drift, and drift still fails loudly", () => {
    const withUnknown = candidate({ reasons: [lawReason({ lawId: "not_in_registry" })] });
    expect(() => blendBoard([market()], [withUnknown], { season: SEASON, constants: roomy, laws: [] })).toThrow(
      /"not_in_registry" fired a BoardReason but has no matching entry/,
    );
  });
});

/**
 * FIT-ROUND TASK 3, DELIVERABLE B — the law-channel grid dimensions. Every one of them has the
 * incumbent behaviour as its null cell, which is what the first test in each pair pins.
 */
describe("blendBoard — law-channel cluster dedup (fit-round Task 3, deliverable B(ii))", () => {
  /** Three CONFIRMED laws: two in the goal-line cluster, one outside it. */
  const GOAL_LINE_A = "threshold:RB:touchdownPointsShare:q70";
  const GOAL_LINE_B = "threshold:RB:insideTenTouchShare:q80";
  const OTHER = "threshold:RB:draftPick:q80";
  const roomy: BlendConstants = { ...CONSTANTS, lawCapPoints: 100, availabilityCapPoints: 0, totalCapPoints: 1000 };
  const exposure = IMPLIED_GAMES / 17;

  const laws = [
    lawFixture({ id: GOAL_LINE_A, origin: "discovered", trainEffect: 2 }),
    lawFixture({ id: GOAL_LINE_B, origin: "discovered", trainEffect: 3 }),
    lawFixture({ id: OTHER, origin: "discovered", trainEffect: 5 }),
  ];
  const withThree = candidate({
    reasons: [lawReason({ lawId: GOAL_LINE_A }), lawReason({ lawId: GOAL_LINE_B }), lawReason({ lawId: OTHER })],
  });

  it("NULL CELL (absent): sums every fired law, exactly as the blend always has", () => {
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withThree], { season: SEASON, constants: roomy, laws });
    expect(seasonPointsOf(blended!)).toBeCloseTo(200 + (2 + 3 + 5) * exposure, 2);
  });

  it("DEDUP ON: the goal-line cluster contributes its STRONGEST law only, the other cluster still adds", () => {
    const deduped: BlendConstants = { ...roomy, lawClusterDedup: true };
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withThree], { season: SEASON, constants: deduped, laws });
    expect(seasonPointsOf(blended!)).toBeCloseTo(200 + (3 + 5) * exposure, 2);
  });

  it("DEDUP ON keeps the strongest law's SIGN, never its absolute value", () => {
    const negative = [
      lawFixture({ id: GOAL_LINE_A, origin: "discovered", trainEffect: -1 }),
      lawFixture({ id: GOAL_LINE_B, origin: "discovered", trainEffect: -4 }),
    ];
    const withTwo = candidate({ reasons: [lawReason({ lawId: GOAL_LINE_A }), lawReason({ lawId: GOAL_LINE_B })] });
    const deduped: BlendConstants = { ...roomy, lawClusterDedup: true };
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withTwo], { season: SEASON, constants: deduped, laws: negative });
    expect(seasonPointsOf(blended!)).toBeCloseTo(200 - 4 * exposure, 2);
  });

  it("DEDUP ON is a NO-OP when every fired law sits in a different cluster", () => {
    const single = candidate({ reasons: [lawReason({ lawId: OTHER })] });
    const summed = blendBoard([market({ marketPoints: 200 })], [single], { season: SEASON, constants: roomy, laws });
    const deduped = blendBoard([market({ marketPoints: 200 })], [single], {
      season: SEASON,
      constants: { ...roomy, lawClusterDedup: true },
      laws,
    });
    expect(seasonPointsOf(deduped[0]!)).toBe(seasonPointsOf(summed[0]!));
  });
});

describe("blendBoard — the per-player law-channel cap (fit-round Task 3, deliverable B(iii))", () => {
  const MANY = ["threshold:RB:touchdownPointsShare:q70", "threshold:RB:insideTenTouchShare:q80", "threshold:RB:draftPick:q80"];
  const laws = MANY.map((id) => lawFixture({ id, origin: "discovered", trainEffect: 20 }));
  const withMany = candidate({ reasons: MANY.map((lawId) => lawReason({ lawId })) });
  const exposure = IMPLIED_GAMES / 17;
  /** Per-law cap generous, availability off, total cap enormous — so ONLY the new cap can bind. */
  const roomy: BlendConstants = { ...CONSTANTS, lawCapPoints: 100, availabilityCapPoints: 0, totalCapPoints: 1000 };

  it("NULL CELL (absent): the law channel is bounded only by the per-law cap and the total cap", () => {
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withMany], { season: SEASON, constants: roomy, laws });
    expect(seasonPointsOf(blended!)).toBeCloseTo(200 + 3 * 20 * exposure, 2);
  });

  it("CAPS the summed law channel at playerLawCapPoints", () => {
    const capped: BlendConstants = { ...roomy, playerLawCapPoints: 7 };
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withMany], { season: SEASON, constants: capped, laws });
    expect(seasonPointsOf(blended!)).toBeCloseTo(207, 6);
  });

  it("bounds the LAW channel only — the availability delta still lands on top of it", () => {
    const capped: BlendConstants = { ...roomy, playerLawCapPoints: 7, availabilityCapPoints: 100 };
    const moreGames = candidate({
      ...withMany,
      games: { expected: IMPLIED_GAMES + 1, rate: 1, distribution: { floor: 0, median: 0, ceiling: 0 }, probabilities: [] },
    });
    const [blended] = blendBoard([market({ marketPoints: 200 })], [moreGames], { season: SEASON, constants: capped, laws });
    // The law channel is pinned at 7; availability adds one game's worth of the market's own rate.
    // The law deltas themselves rescale with the changed exposure, but the cap binds either way.
    expect(seasonPointsOf(blended!)).toBeCloseTo(207 + 200 / IMPLIED_GAMES, 2);
  });

  it("REFUSES a negative cap — a negative bound would invert every delta it touched rather than bounding it", () => {
    expect(() =>
      blendBoard([market()], [withMany], { season: SEASON, constants: { ...roomy, playerLawCapPoints: -5 }, laws }),
    ).toThrow(/playerLawCapPoints must be a finite, non-negative number/);
  });

  it("composes with dedup: dedup picks one per cluster, THEN the per-player cap bounds the sum", () => {
    const both: BlendConstants = { ...roomy, lawClusterDedup: true, playerLawCapPoints: 1000 };
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withMany], { season: SEASON, constants: both, laws });
    // Two clusters survive dedup (goal-line, draftPick), each at 20; the 1000 cap never binds.
    expect(seasonPointsOf(blended!)).toBeCloseTo(200 + 2 * 20 * exposure, 2);
  });
});

describe("blendBoard — the props anchor (fit-round Task 3, deliverable C)", () => {
  const roomy: BlendConstants = { ...CONSTANTS, lawCapPoints: 0, availabilityCapPoints: 0, totalCapPoints: 0 };
  const anchor = new Map([["player-1", 100]]);

  it("NULL CELL (weight absent): the anchor is marketPoints, bit for bit, even with a props map present", () => {
    const [blended] = blendBoard([market({ marketPoints: 233.47 })], [candidate()], {
      season: SEASON,
      constants: roomy,
      laws: [],
      propsAnchor: anchor,
    });
    expect(seasonPointsOf(blended!)).toBeCloseTo(233.47, 6);
    expect(blended!.reasons).toContainEqual({ code: "market_anchor", marketPoints: 233.47, delta: 0 });
  });

  it("blends ADP toward the props anchor at the fitted weight", () => {
    const [blended] = blendBoard([market({ marketPoints: 200 })], [candidate()], {
      season: SEASON,
      constants: { ...roomy, propsAnchorWeight: 0.25 },
      laws: [],
      propsAnchor: anchor,
    });
    expect(seasonPointsOf(blended!)).toBeCloseTo(0.75 * 200 + 0.25 * 100, 4);
    expect(blended!.reasons).toContainEqual({ code: "market_anchor", marketPoints: 175, delta: 0 });
  });

  it("falls back to ADP, per player, for a player the archive has no line for — at ANY weight", () => {
    const [blended] = blendBoard([market({ playerId: "unarchived", marketPoints: 200 })], [candidate({ playerId: "unarchived" })], {
      season: SEASON,
      constants: { ...roomy, propsAnchorWeight: 1 },
      laws: [],
      propsAnchor: anchor,
    });
    expect(seasonPointsOf(blended!)).toBeCloseTo(200, 6);
  });

  it("falls back to ADP for a season with NO archive at all (an empty map)", () => {
    const [blended] = blendBoard([market({ marketPoints: 200 })], [candidate()], {
      season: SEASON,
      constants: { ...roomy, propsAnchorWeight: 0.5 },
      laws: [],
      propsAnchor: new Map(),
    });
    expect(seasonPointsOf(blended!)).toBeCloseTo(200, 6);
  });

  it("REFUSES a weight outside [0, 1] — extrapolating past either anchor is not a blend", () => {
    expect(() =>
      blendBoard([market()], [candidate()], { season: SEASON, constants: { ...roomy, propsAnchorWeight: 1.5 }, laws: [], propsAnchor: anchor }),
    ).toThrow(/propsAnchorWeight must lie in \[0, 1\]/);
  });

  it("prices the availability gap off the ANCHOR, not off the raw ADP number", () => {
    const withGap = candidate({
      games: { expected: IMPLIED_GAMES + 1, rate: 1, distribution: { floor: 0, median: 0, ceiling: 0 }, probabilities: [] },
    });
    const constants: BlendConstants = { ...CONSTANTS, lawCapPoints: 0, availabilityCapPoints: 100, totalCapPoints: 100, propsAnchorWeight: 0.5 };
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withGap], { season: SEASON, constants, laws: [], propsAnchor: anchor });
    const anchored = 0.5 * 200 + 0.5 * 100;
    expect(seasonPointsOf(blended!)).toBeCloseTo(anchored + anchored / IMPLIED_GAMES, 2);
  });
});

describe("withLawsAblated", () => {
  it("zeroes lawCapPoints and leaves every other field untouched", () => {
    const ablated = withLawsAblated(CONSTANTS);
    expect(ablated.lawCapPoints).toBe(0);
    expect(ablated.availabilityCapPoints).toBe(CONSTANTS.availabilityCapPoints);
    expect(ablated.totalCapPoints).toBe(CONSTANTS.totalCapPoints);
    expect(ablated.impliedGamesByPosition).toEqual(CONSTANTS.impliedGamesByPosition);
  });
});

describe("scoreBlendConstants — the grid search's own scoring rule", () => {
  function row(overrides: Partial<BlendTrainRow> = {}): BlendTrainRow {
    return { season: 2019, market: market(), candidate: candidate(), actualPoints: 200, ...overrides };
  }

  it("REFUSES a row past BLEND_TRAIN_CUTOFF_SEASON — a grid search scored on a season it will later be judged on is not a measurement", () => {
    expect(() =>
      scoreBlendConstants([row({ season: BLEND_TRAIN_CUTOFF_SEASON + 1 })], CONSTANTS, { heldOutSeasons: [], laws: [] }),
    ).toThrow(new RegExp(`past BLEND_TRAIN_CUTOFF_SEASON \\(${BLEND_TRAIN_CUTOFF_SEASON}\\)`));
  });

  it("REFUSES a held-out season even when it sits at or before the cutoff", () => {
    expect(() => scoreBlendConstants([row({ season: 2019 })], CONSTANTS, { heldOutSeasons: [2019], laws: [] })).toThrow(/held out/);
  });

  it("accepts the cutoff season itself", () => {
    expect(() =>
      scoreBlendConstants([row({ season: BLEND_TRAIN_CUTOFF_SEASON })], CONSTANTS, { heldOutSeasons: [], laws: [] }),
    ).not.toThrow();
  });

  it("is DETERMINISTIC — the same rows and constants score identically across repeated calls", () => {
    const rows = [
      row({ market: market({ playerId: "a", marketPoints: 100 }), candidate: candidate({ playerId: "a" }), actualPoints: 90 }),
      row({ market: market({ playerId: "b", marketPoints: 200 }), candidate: candidate({ playerId: "b" }), actualPoints: 240 }),
      row({ market: market({ playerId: "c", marketPoints: 150 }), candidate: candidate({ playerId: "c" }), actualPoints: 60 }),
    ];
    const first = scoreBlendConstants(rows, CONSTANTS, { heldOutSeasons: [], laws: [] });
    const second = scoreBlendConstants(rows, CONSTANTS, { heldOutSeasons: [], laws: [] });
    expect(first).toBe(second);
  });

  it("returns null when there is no variance to correlate, exactly like `spearman` itself", () => {
    const rows = [row({ market: market({ playerId: "a", marketPoints: 100 }), candidate: candidate({ playerId: "a" }), actualPoints: 90 })];
    expect(scoreBlendConstants(rows, CONSTANTS, { heldOutSeasons: [], laws: [] })).toBeNull();
  });
});

describe("fitMarketTailByPosition — the fix round 2 structural guard's own fit", () => {
  function trainRow(overrides: Partial<BlendTrainRow> = {}): BlendTrainRow {
    return { season: 2019, market: market(), candidate: candidate(), actualPoints: 0, ...overrides };
  }

  it("REFUSES a row past BLEND_TRAIN_CUTOFF_SEASON", () => {
    expect(() => fitMarketTailByPosition([trainRow({ season: BLEND_TRAIN_CUTOFF_SEASON + 1 })])).toThrow(
      new RegExp(`past BLEND_TRAIN_CUTOFF_SEASON \\(${BLEND_TRAIN_CUTOFF_SEASON}\\)`),
    );
  });

  it("takes the SMALLEST marketPoints seen at each position — the curve's own value at the deepest listed rank, by monotonicity", () => {
    const rows = [
      trainRow({ candidate: candidate({ position: "RB" }), market: market({ position: "RB", marketPoints: 200 }) }),
      trainRow({ candidate: candidate({ position: "RB" }), market: market({ position: "RB", marketPoints: 51 }) }),
      trainRow({ candidate: candidate({ position: "RB" }), market: market({ position: "RB", marketPoints: 120 }) }),
      trainRow({ candidate: candidate({ position: "WR" }), market: market({ position: "WR", marketPoints: 300 }) }),
      trainRow({ candidate: candidate({ position: "QB" }), market: market({ position: "QB", marketPoints: 250 }) }),
      trainRow({ candidate: candidate({ position: "TE" }), market: market({ position: "TE", marketPoints: 80 }) }),
    ];
    const tails = fitMarketTailByPosition(rows);
    expect(tails.RB).toBe(51);
    expect(tails.WR).toBe(300);
  });

  it("throws for a position with zero train rows — an empty population is a fit-input bug, not a zero", () => {
    const rows = [
      trainRow({ candidate: candidate({ position: "RB" }), market: market({ position: "RB" }) }),
      trainRow({ candidate: candidate({ position: "WR" }), market: market({ position: "WR" }) }),
      trainRow({ candidate: candidate({ position: "TE" }), market: market({ position: "TE" }) }),
    ];
    expect(() => fitMarketTailByPosition(rows)).toThrow(/no train rows at position "QB"/);
  });
});

describe("detectPlateau — the fix round 2 plateau guard (ruling 4b)", () => {
  const CEILING = 80;

  function cell(overrides: Partial<BlendConstants> = {}, score: number | null = 0.6): { readonly constants: BlendConstants; readonly score: number | null } {
    return { constants: { ...CONSTANTS, ...overrides }, score };
  }

  it("counts every cell within tolerance of the best score, the winner included", () => {
    const cells = [cell({ lawCapPoints: 0 }, 0.605), cell({ lawCapPoints: 2 }, 0.6053), cell({ lawCapPoints: 5 }, 0.4)];
    const report = detectPlateau(cells, 0.6053, CEILING, 1e-3);
    expect(report.tiedCellCount).toBe(2);
  });

  it("flags anyTiedAtCeiling when a tied cell sits at the ceiling on ANY cap axis", () => {
    const cells = [cell({ availabilityCapPoints: CEILING }, 0.6053), cell({ availabilityCapPoints: 40 }, 0.6053)];
    expect(detectPlateau(cells, 0.6053, CEILING).anyTiedAtCeiling).toBe(true);
  });

  it("does NOT flag anyTiedAtCeiling when no tied cell reaches the ceiling on any axis", () => {
    const cells = [cell({ availabilityCapPoints: 40, totalCapPoints: 20, lawCapPoints: 2 }, 0.6053)];
    expect(detectPlateau(cells, 0.6053, CEILING).anyTiedAtCeiling).toBe(false);
  });

  it("excludes a null-score cell from the tied count, never treating null as a match", () => {
    const cells = [cell({}, null), cell({ lawCapPoints: 2 }, 0.6053)];
    expect(detectPlateau(cells, 0.6053, CEILING).tiedCellCount).toBe(1);
  });

  it("respects a custom tolerance", () => {
    const cells = [cell({}, 0.6), cell({ lawCapPoints: 2 }, 0.6053)];
    expect(detectPlateau(cells, 0.6053, CEILING, 1e-4).tiedCellCount).toBe(1);
    expect(detectPlateau(cells, 0.6053, CEILING, 0.1).tiedCellCount).toBe(2);
  });
});

/**
 * `assertLiveMarketCoverage` (Task 4 fix round 2, I1) — the degeneracy guard, upgraded from a
 * whole-board zero check to a PER-POSITION COVERAGE FLOOR. Unit-tested directly (rather than only
 * through `shippedPreseasonCandidates`'s own DB-backed tests in `source.test.ts`) because the
 * function's whole job is arithmetic over `candidates`/`market`, and a pure test can enumerate the
 * truth table exhaustively without a database.
 */
describe("assertLiveMarketCoverage — the per-position coverage floor (Task 4 fix round 2, I1)", () => {
  function inputsFixture(momentKind: "live" | "replay" = "live") {
    return { season: SEASON, moment: new Date("2026-09-01T00:00:00.000Z"), momentKind };
  }

  it("refuses a LIVE board with ZERO listed market players overall, regardless of what candidates holds", () => {
    expect(() => assertLiveMarketCoverage(inputsFixture(), [candidate()], [])).toThrow(/ZERO listed market players/);
  });

  it("does NOT refuse a REPLAY board with zero listed market players — an established, legitimate state", () => {
    expect(() => assertLiveMarketCoverage(inputsFixture("replay"), [candidate()], [])).not.toThrow();
  });

  it("refuses a LIVE board when a position ON OUR OWN BOARD has fewer than the floor listed, naming it", () => {
    const candidates = [candidate({ playerId: "rb-1", position: "RB" }), candidate({ playerId: "wr-1", position: "WR" })];
    const thinRb = Array.from({ length: MINIMUM_LISTED_PER_POSITION - 1 }, (_, i) => market({ playerId: `rb-market-${i}`, position: "RB" }));
    const healthyWr = Array.from({ length: MINIMUM_LISTED_PER_POSITION }, (_, i) => market({ playerId: `wr-market-${i}`, position: "WR" }));
    expect(() => assertLiveMarketCoverage(inputsFixture(), candidates, [...thinRb, ...healthyWr])).toThrow(
      new RegExp(`RB \\(${MINIMUM_LISTED_PER_POSITION - 1} listed\\)`),
    );
  });

  it("does NOT refuse when every position on the board clears the floor", () => {
    const candidates = [candidate({ playerId: "rb-1", position: "RB" }), candidate({ playerId: "wr-1", position: "WR" })];
    const healthyRb = Array.from({ length: MINIMUM_LISTED_PER_POSITION }, (_, i) => market({ playerId: `rb-market-${i}`, position: "RB" }));
    const healthyWr = Array.from({ length: MINIMUM_LISTED_PER_POSITION }, (_, i) => market({ playerId: `wr-market-${i}`, position: "WR" }));
    expect(() => assertLiveMarketCoverage(inputsFixture(), candidates, [...healthyRb, ...healthyWr])).not.toThrow();
  });

  it("is exactly the boundary: MINIMUM_LISTED_PER_POSITION itself does NOT refuse, only strictly fewer", () => {
    const candidates = [candidate({ playerId: "rb-1", position: "RB" })];
    const exactlyAtFloor = Array.from({ length: MINIMUM_LISTED_PER_POSITION }, (_, i) => market({ playerId: `rb-market-${i}`, position: "RB" }));
    expect(() => assertLiveMarketCoverage(inputsFixture(), candidates, exactlyAtFloor)).not.toThrow();

    const oneBelowFloor = exactlyAtFloor.slice(1);
    expect(() => assertLiveMarketCoverage(inputsFixture(), candidates, oneBelowFloor)).toThrow();
  });

  it("ignores a position with NO candidates of our own, even when the market lists nobody there either", () => {
    // Our board only prices WR here; the market carrying zero QB rows says nothing about a
    // position we never asked it about.
    const candidates = [candidate({ playerId: "wr-1", position: "WR" })];
    const healthyWr = Array.from({ length: MINIMUM_LISTED_PER_POSITION }, (_, i) => market({ playerId: `wr-market-${i}`, position: "WR" }));
    expect(() => assertLiveMarketCoverage(inputsFixture(), candidates, healthyWr)).not.toThrow();
  });

  it("names EVERY thin position at once, not only the first it finds", () => {
    const candidates = [
      candidate({ playerId: "rb-1", position: "RB" }),
      candidate({ playerId: "wr-1", position: "WR" }),
      candidate({ playerId: "te-1", position: "TE" }),
    ];
    const thinRb = [market({ playerId: "rb-market-0", position: "RB" })];
    const healthyWr = Array.from({ length: MINIMUM_LISTED_PER_POSITION }, (_, i) => market({ playerId: `wr-market-${i}`, position: "WR" }));
    const thinTe = [market({ playerId: "te-market-0", position: "TE" })];
    let error: Error | undefined;
    try {
      assertLiveMarketCoverage(inputsFixture(), candidates, [...thinRb, ...healthyWr, ...thinTe]);
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).toMatch(/RB \(1 listed\)/);
    expect(error?.message).toMatch(/TE \(1 listed\)/);
    expect(error?.message).not.toMatch(/WR \(/);
  });
});
