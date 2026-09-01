import { describe, expect, it } from "vitest";
import type { StatLine } from "@/domain/player";
import type { BoardCandidate, BoardReason } from "../preseason/board";
import { teamGamesIn } from "../preseason/availability";
import { rookieCurve } from "../preseason/rookie-curve";
import type { MarketPriorEntry } from "./curve";
import {
  BLEND_TRAIN_CUTOFF_SEASON,
  blendBoard,
  seasonPointsOf,
  scoreBlendConstants,
  type BlendConstants,
  type BlendTrainRow,
} from "./blend";

const SEASON = 2020;
const TEAM_GAMES = teamGamesIn(SEASON);

/** Small, easy-to-reason-about constants — never the committed fit, so a test never breaks
 *  silently when the real grid search re-fits. */
const CONSTANTS: BlendConstants = {
  lawCapPoints: 20,
  availabilityCapPoints: 40,
  totalCapPoints: 50,
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
      expected: TEAM_GAMES,
      rate: 1,
      distribution: { floor: TEAM_GAMES, median: TEAM_GAMES, ceiling: TEAM_GAMES },
      probabilities: [],
    },
    reasons: [],
    ...overrides,
  };
}

function market(overrides: Partial<MarketPriorEntry> = {}): MarketPriorEntry {
  return { playerId: "player-1", position: "RB", adpRank: 10, marketPoints: 220, ...overrides };
}

function lawReason(overrides: Partial<Extract<BoardReason, { code: "law" }>> = {}): BoardReason {
  return { code: "law", lawId: "rb_workload_cliff", effect: 2, magnitude: 300, ...overrides };
}

describe("blendBoard", () => {
  it("PIN: a player with no admitted evidence gets marketPoints EXACTLY — the identity the whole design rests on", () => {
    const [blended] = blendBoard([market({ marketPoints: 233.47 })], [candidate()], { season: SEASON, constants: CONSTANTS });
    expect(seasonPointsOf(blended!)).toBeCloseTo(233.47, 6);
  });

  it("admits a single law's delta, exposure-scaled and capped, and moves the player off market", () => {
    const cheapCap: BlendConstants = { ...CONSTANTS, lawCapPoints: 100, totalCapPoints: 100 };
    const withLaw = candidate({ reasons: [lawReason({ effect: 2 })] });
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withLaw], { season: SEASON, constants: cheapCap });
    // effect (2 pts/game) * expectedGames/17 — expectedGames === TEAM_GAMES (17 in 2020? no, 2020 is
    // pre-2021 so TEAM_GAMES === 16).
    const expectedDelta = 2 * (TEAM_GAMES / 17);
    // `computeFantasyPoints` rounds to two decimal places (`roundPoints`), and this expected delta
    // is not a terminating decimal, so the comparison is at that same two-decimal precision.
    expect(seasonPointsOf(blended!)).toBeCloseTo(200 + expectedDelta, 2);
  });

  it("CAPS a single law's delta at lawCapPoints, regardless of how large the raw effect is", () => {
    const tinyCap: BlendConstants = { ...CONSTANTS, lawCapPoints: 3, totalCapPoints: 100 };
    const withHugeLaw = candidate({ reasons: [lawReason({ effect: 500 })] });
    const [blended] = blendBoard([market({ marketPoints: 200 })], [withHugeLaw], { season: SEASON, constants: tinyCap });
    expect(seasonPointsOf(blended!)).toBeCloseTo(203, 6);
  });

  it("CAPS the combined total delta at totalCapPoints even when several admitted deltas would sum higher", () => {
    const tinyTotal: BlendConstants = { lawCapPoints: 100, availabilityCapPoints: 100, totalCapPoints: 5 };
    const overExpected = candidate({
      reasons: [lawReason({ effect: 50 })],
      games: { expected: TEAM_GAMES, rate: 1, distribution: { floor: 0, median: 0, ceiling: 0 }, probabilities: [] },
    });
    const [blended] = blendBoard([market({ marketPoints: 200 })], [overExpected], { season: SEASON, constants: tinyTotal });
    expect(seasonPointsOf(blended!)).toBeCloseTo(205, 6);
  });

  it("admits a POSITIVE availability delta when expected games exceed the market's implicit full-season assumption", () => {
    const roomy: BlendConstants = { ...CONSTANTS, availabilityCapPoints: 100, totalCapPoints: 100 };
    const moreGames = candidate({
      games: { expected: TEAM_GAMES + 2, rate: 1, distribution: { floor: 0, median: 0, ceiling: 0 }, probabilities: [] },
    });
    const [blended] = blendBoard([market({ marketPoints: 200 })], [moreGames], { season: SEASON, constants: roomy });
    const expectedDelta = 2 * (200 / TEAM_GAMES);
    expect(seasonPointsOf(blended!)).toBeCloseTo(200 + expectedDelta, 6);
    expect(seasonPointsOf(blended!)).toBeGreaterThan(200);
  });

  it("admits a NEGATIVE availability delta when expected games fall short of the market's implicit assumption", () => {
    const roomy: BlendConstants = { ...CONSTANTS, availabilityCapPoints: 100, totalCapPoints: 100 };
    const fewerGames = candidate({
      games: { expected: TEAM_GAMES - 4, rate: 1, distribution: { floor: 0, median: 0, ceiling: 0 }, probabilities: [] },
    });
    const [blended] = blendBoard([market({ marketPoints: 200 })], [fewerGames], { season: SEASON, constants: roomy });
    const expectedDelta = -4 * (200 / TEAM_GAMES);
    expect(seasonPointsOf(blended!)).toBeCloseTo(200 + expectedDelta, 6);
    expect(seasonPointsOf(blended!)).toBeLessThan(200);
  });

  it("CAPS the availability delta at availabilityCapPoints", () => {
    const tinyAvailability: BlendConstants = { lawCapPoints: 100, availabilityCapPoints: 1, totalCapPoints: 100 };
    const fewerGames = candidate({
      games: { expected: 1, rate: 1, distribution: { floor: 0, median: 0, ceiling: 0 }, probabilities: [] },
    });
    const [blended] = blendBoard([market({ marketPoints: 200 })], [fewerGames], { season: SEASON, constants: tinyAvailability });
    expect(seasonPointsOf(blended!)).toBeCloseTo(199, 6);
  });

  it("floors the blended total at zero even if capped deltas would otherwise push it negative", () => {
    const permissive: BlendConstants = { lawCapPoints: 1000, availabilityCapPoints: 1000, totalCapPoints: 1000 };
    const fewerGames = candidate({
      games: { expected: 0, rate: 0, distribution: { floor: 0, median: 0, ceiling: 0 }, probabilities: [] },
    });
    const [blended] = blendBoard([market({ marketPoints: 5 })], [fewerGames], { season: SEASON, constants: permissive });
    expect(seasonPointsOf(blended!)).toBeGreaterThanOrEqual(0);
  });

  it("REPLACES marketPoints with rookieCurve for a rookie, ignoring the market's own number entirely", () => {
    const rookie = candidate({
      position: "WR",
      reasons: [{ code: "rookie", overallPick: 5, landingMultiplier: 1 }],
    });
    const [blended] = blendBoard([market({ marketPoints: 999 })], [rookie], { season: SEASON, constants: CONSTANTS });
    expect(seasonPointsOf(blended!)).toBeCloseTo(rookieCurve("WR", 5), 6);
  });

  it("a rookie with no draft pick on record (overallPick null) is NOT substituted — falls through to the market/evidence path", () => {
    const undraftedRookie = candidate({ reasons: [{ code: "rookie", overallPick: null, landingMultiplier: 1 }] });
    const [blended] = blendBoard([market({ marketPoints: 200 })], [undraftedRookie], { season: SEASON, constants: CONSTANTS });
    expect(seasonPointsOf(blended!)).toBeCloseTo(200, 6);
  });

  it("FALLS BACK to the raw model points for a player absent from the market board, tagging the reason", () => {
    const raw = candidate({ perGame: line({ receivingYards: 50 }) });
    const rawSeasonPoints = seasonPointsOf(raw);
    const [blended] = blendBoard([], [raw], { season: SEASON, constants: CONSTANTS });
    expect(seasonPointsOf(blended!)).toBeCloseTo(rawSeasonPoints, 6);
    expect(blended!.reasons).toContainEqual({ code: "market_unlisted" });
    expect(blended!.perGame).toBe(raw.perGame);
  });

  it("carries every OTHER candidate's own fields through unchanged (team, position, games) alongside the blended points", () => {
    const original = candidate({ team: "SF", position: "WR" });
    const [blended] = blendBoard([market({ marketPoints: 150, position: "WR" })], [original], { season: SEASON, constants: CONSTANTS });
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
    const blended = blendBoard([marketA, marketB], [a, b], { season: SEASON, constants: CONSTANTS });
    expect(blended).toHaveLength(2);
    expect(seasonPointsOf(blended.find((c) => c.playerId === "a")!)).toBeCloseTo(100, 6);
    expect(seasonPointsOf(blended.find((c) => c.playerId === "b")!)).toBeCloseTo(300, 6);
  });
});

describe("scoreBlendConstants — the grid search's own scoring rule", () => {
  function row(overrides: Partial<BlendTrainRow> = {}): BlendTrainRow {
    return { season: 2019, market: market(), candidate: candidate(), actualPoints: 200, ...overrides };
  }

  it("REFUSES a row past BLEND_TRAIN_CUTOFF_SEASON — a grid search scored on a season it will later be judged on is not a measurement", () => {
    expect(() => scoreBlendConstants([row({ season: BLEND_TRAIN_CUTOFF_SEASON + 1 })], CONSTANTS, { heldOutSeasons: [] })).toThrow(
      new RegExp(`past BLEND_TRAIN_CUTOFF_SEASON \\(${BLEND_TRAIN_CUTOFF_SEASON}\\)`),
    );
  });

  it("REFUSES a held-out season even when it sits at or before the cutoff", () => {
    expect(() => scoreBlendConstants([row({ season: 2019 })], CONSTANTS, { heldOutSeasons: [2019] })).toThrow(/held out/);
  });

  it("accepts the cutoff season itself", () => {
    expect(() => scoreBlendConstants([row({ season: BLEND_TRAIN_CUTOFF_SEASON })], CONSTANTS, { heldOutSeasons: [] })).not.toThrow();
  });

  it("is DETERMINISTIC — the same rows and constants score identically across repeated calls", () => {
    const rows = [
      row({ market: market({ playerId: "a", marketPoints: 100 }), candidate: candidate({ playerId: "a" }), actualPoints: 90 }),
      row({ market: market({ playerId: "b", marketPoints: 200 }), candidate: candidate({ playerId: "b" }), actualPoints: 240 }),
      row({ market: market({ playerId: "c", marketPoints: 150 }), candidate: candidate({ playerId: "c" }), actualPoints: 60 }),
    ];
    const first = scoreBlendConstants(rows, CONSTANTS, { heldOutSeasons: [] });
    const second = scoreBlendConstants(rows, CONSTANTS, { heldOutSeasons: [] });
    expect(first).toBe(second);
  });

  it("returns null when there is no variance to correlate, exactly like `spearman` itself", () => {
    const rows = [
      row({ market: market({ playerId: "a", marketPoints: 100 }), candidate: candidate({ playerId: "a" }), actualPoints: 90 }),
    ];
    expect(scoreBlendConstants(rows, CONSTANTS, { heldOutSeasons: [] })).toBeNull();
  });
});
