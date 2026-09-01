import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers } from "@/db/schema";
import { STAT_LINE_SOURCE } from "../lines";
import { DERIVED_STAT_LINE_SOURCE } from "../nflverse/derived-stat-lines";
import { BENCHMARK_SOURCES } from "../preseason/benchmarks";
import { recordPreseasonRankings, recordPreseasonRosters, type PreseasonRankingRow, type PreseasonRosterRow } from "../preseason/store";
import { recordObservations, type PlayerWeekObservation } from "../store";
import { FITTED_MARKET_CURVE } from "./curve-fitted";
import {
  fitMarketCurve,
  loadMarketCurveObservations,
  marketBoard,
  marketCurve,
  MARKET_CURVE_TRAIN_CUTOFF_SEASON,
  type MarketCurveObservation,
  type MarketCurvePriors,
} from "./curve";

function observation(overrides: Partial<MarketCurveObservation> = {}): MarketCurveObservation {
  return { season: 2020, position: "RB", adpRank: 10, points: 100, ...overrides };
}

describe("fitMarketCurve", () => {
  it("REFUSES a held-out season — a curve fitted on a season it is later scored against is not a measurement", () => {
    expect(() => fitMarketCurve([observation({ season: 2022 })], { heldOutSeasons: [2022] })).toThrow(/held out/);
  });

  it("REFUSES a season past MARKET_CURVE_TRAIN_CUTOFF_SEASON even with an EMPTY held-out list — the constant is the contract, not caller discipline", () => {
    const observations = [observation({ season: MARKET_CURVE_TRAIN_CUTOFF_SEASON + 1 })];
    expect(() => fitMarketCurve(observations, { heldOutSeasons: [] })).toThrow(
      new RegExp(`past MARKET_CURVE_TRAIN_CUTOFF_SEASON \\(${MARKET_CURVE_TRAIN_CUTOFF_SEASON}\\)`),
    );
  });

  it("accepts the cutoff season itself, exactly at the boundary", () => {
    expect(() => fitMarketCurve([observation({ season: MARKET_CURVE_TRAIN_CUTOFF_SEASON })], { heldOutSeasons: [] })).not.toThrow();
  });

  it("takes the mean at a rank with more than one observation across seasons", () => {
    const priors = fitMarketCurve(
      [observation({ adpRank: 5, points: 100 }), observation({ adpRank: 5, points: 200, season: 2021 })],
      { heldOutSeasons: [] },
    );
    expect(priors.RB).toEqual([{ adpRank: 5, points: 150 }]);
  });

  it("LEAVES AN ALREADY-MONOTONE SEQUENCE EXACTLY WHERE THE MEANS PUT IT — no smoothing where none is needed", () => {
    const priors = fitMarketCurve(
      [
        observation({ adpRank: 1, points: 300 }),
        observation({ adpRank: 50, points: 150 }),
        observation({ adpRank: 100, points: 50 }),
      ],
      { heldOutSeasons: [] },
    );
    expect(priors.RB).toEqual([
      { adpRank: 1, points: 300 },
      { adpRank: 50, points: 150 },
      { adpRank: 100, points: 50 },
    ]);
  });

  it("POOLS A VIOLATION — a later rank whose raw mean is noisily HIGHER than an earlier one is never left that way", () => {
    const priors = fitMarketCurve(
      [observation({ adpRank: 10, points: 100 }), observation({ adpRank: 20, points: 120 }), observation({ adpRank: 30, points: 40 })],
      { heldOutSeasons: [] },
    );
    expect(priors.RB).toEqual([
      { adpRank: 10, points: 110 },
      { adpRank: 20, points: 110 },
      { adpRank: 30, points: 40 },
    ]);
  });

  it("weights the pool by how many observations backed each rank, not by rank count alone", () => {
    const priors = fitMarketCurve(
      [
        observation({ adpRank: 10, points: 100, season: 2018 }),
        observation({ adpRank: 10, points: 100, season: 2019 }),
        observation({ adpRank: 10, points: 100, season: 2020 }),
        observation({ adpRank: 20, points: 400, season: 2021 }),
      ],
      { heldOutSeasons: [] },
    );
    expect(priors.RB).toEqual([
      { adpRank: 10, points: 175 },
      { adpRank: 20, points: 175 },
    ]);
  });

  it("keeps QB, WR and TE independent of RB and of each other", () => {
    const priors = fitMarketCurve(
      [observation({ position: "RB", adpRank: 5, points: 300 }), observation({ position: "WR", adpRank: 5, points: 50 })],
      { heldOutSeasons: [] },
    );
    expect(priors.RB).toEqual([{ adpRank: 5, points: 300 }]);
    expect(priors.WR).toEqual([{ adpRank: 5, points: 50 }]);
    expect(priors.QB).toEqual([]);
    expect(priors.TE).toEqual([]);
  });
});

describe("marketCurve", () => {
  const PRIORS: MarketCurvePriors = {
    QB: [
      { adpRank: 1, points: 280 },
      { adpRank: 10, points: 200 },
      { adpRank: 100, points: 40 },
    ],
    RB: [],
    WR: [],
    TE: [],
  };

  it("returns the exact fitted value AT a knot, never an interpolated approximation of it", () => {
    expect(marketCurve("QB", 10, PRIORS)).toBe(200);
    expect(marketCurve("QB", 1, PRIORS)).toBe(280);
    expect(marketCurve("QB", 100, PRIORS)).toBe(40);
  });

  it("interpolates linearly between the two nearest knots", () => {
    // Halfway from rank 1 (280) to rank 10 (200) in rank-space is rank 5.5, expecting 240.
    expect(marketCurve("QB", 5.5, PRIORS)).toBeCloseTo(240, 10);
  });

  it("reads a fractional, real-valued ADP rank directly — the fit rounds, the read does not", () => {
    expect(marketCurve("QB", 9.1, PRIORS)).toBeCloseTo(200 + (280 - 200) * (1 - (9.1 - 1) / 9), 10);
  });

  it("clamps below the earliest knot and above the latest, rather than extrapolating a curve nobody fitted", () => {
    expect(marketCurve("QB", -5, PRIORS)).toBe(280);
    expect(marketCurve("QB", 250, PRIORS)).toBe(40);
  });

  it("returns 0 for a position the curve carries no knots for, K and DEF included", () => {
    expect(marketCurve("RB", 5, PRIORS)).toBe(0);
    expect(marketCurve("K", 5, PRIORS)).toBe(0);
    expect(marketCurve("DEF", 5, PRIORS)).toBe(0);
  });

  it("defaults to the committed fit when no priors are supplied", () => {
    expect(marketCurve("RB", 1)).toBe(marketCurve("RB", 1, FITTED_MARKET_CURVE));
  });

  it("PIN: is monotone non-increasing across ranks 1..300, for a synthetic curve with real gaps between knots", () => {
    for (let rank = 1; rank < 300; rank += 1) {
      expect(marketCurve("QB", rank + 1, PRIORS)).toBeLessThanOrEqual(marketCurve("QB", rank, PRIORS) + 1e-9);
    }
  });

  it("CLAMPS A SUB-ZERO FITTED VALUE AT ZERO — a points baseline for a blend is non-negative by construction", () => {
    const negativeTail: MarketCurvePriors = {
      QB: [
        { adpRank: 1, points: 200 },
        { adpRank: 250, points: -0.05 },
      ],
      RB: [],
      WR: [],
      TE: [],
    };
    expect(marketCurve("QB", 250, negativeTail)).toBe(0);
    expect(marketCurve("QB", 300, negativeTail)).toBe(0);
  });
});

describe("the committed fit", () => {
  it("PIN: is monotone non-increasing across ADP ranks 1..300, at every skill position", () => {
    // The premise the whole curve exists to serve: a market that drafted a player earlier can never
    // imply a lower expected season. Checked over the real committed fit, not a synthetic stand-in.
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      for (let rank = 1; rank < 300; rank += 1) {
        const above = marketCurve(position, rank);
        const below = marketCurve(position, rank + 1);
        expect(below).toBeLessThanOrEqual(above + 1e-9);
      }
    }
  });

  it("has real, non-degenerate knots for every skill position", () => {
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      expect(FITTED_MARKET_CURVE[position].length).toBeGreaterThan(0);
    }
  });

  it("never fits past MARKET_CURVE_TRAIN_CUTOFF_SEASON", () => {
    expect(MARKET_CURVE_TRAIN_CUTOFF_SEASON).toBe(2021);
  });
});

describe("loadMarketCurveObservations and marketBoard", () => {
  const db = createTestDb();

  const PLAYER_A = "00-0037001"; // ranked #3 ADP, RB
  const PLAYER_B = "00-0037002"; // ranked #40 ADP, never dresses
  const PLAYER_C = "00-0037003"; // ranked ADP in the 2019 GAP season
  const PLAYER_D = "00-0037004"; // ranked on the board but never given a preseason roster row

  const EARLY_AUGUST = (season: number): Date => new Date(Date.UTC(season, 7, 15));
  const GAME_DERIVED_STAMP = (season: number): Date => new Date(Date.UTC(season, 8, 10));

  beforeEach(async () => {
    await truncateAll(db);
    await db.insert(nflPlayers).values([
      { id: PLAYER_A, pfrId: "AA", name: "A", position: "RB", latestTeam: "KC", rookieSeason: 2018, lastSeason: 2024 },
      { id: PLAYER_B, pfrId: "BB", name: "B", position: "RB", latestTeam: "KC", rookieSeason: 2018, lastSeason: 2020 },
      { id: PLAYER_C, pfrId: "CC", name: "C", position: "RB", latestTeam: "KC", rookieSeason: 2018, lastSeason: 2024 },
      { id: PLAYER_D, pfrId: "DD", name: "D", position: "RB", latestTeam: "KC", rookieSeason: 2018, lastSeason: 2024 },
    ]);
  });

  function ranking(overrides: Partial<PreseasonRankingRow> = {}): PreseasonRankingRow {
    return { season: 2020, source: BENCHMARK_SOURCES.adp, playerId: PLAYER_A, rank: 3, asOf: EARLY_AUGUST(2020), ...overrides };
  }

  function roster(overrides: Partial<PreseasonRosterRow> = {}): PreseasonRosterRow {
    return {
      season: 2020,
      team: "KC",
      playerId: PLAYER_A,
      position: "RB",
      status: "active",
      birthDate: null,
      draftYear: null,
      draftPick: null,
      draftClub: null,
      asOf: EARLY_AUGUST(2020),
      ...overrides,
    };
  }

  function statLine(overrides: Partial<PlayerWeekObservation> = {}): PlayerWeekObservation {
    return {
      season: 2020,
      week: 1,
      playerId: PLAYER_A,
      source: STAT_LINE_SOURCE,
      metric: "rushing_yards",
      value: 0,
      asOf: GAME_DERIVED_STAMP(2020),
      ...overrides,
    };
  }

  describe("loadMarketCurveObservations", () => {
    it("sums a season's worth of weekly stat lines into one season points total, at the board's own ADP rank", async () => {
      await recordPreseasonRankings(db, [ranking()]);
      await recordPreseasonRosters(db, [roster()]);
      await recordObservations(db, [
        statLine({ season: 2020, week: 1, playerId: PLAYER_A, value: 100 }),
        statLine({ season: 2020, week: 2, playerId: PLAYER_A, value: 50 }),
      ]);
      const observations = await loadMarketCurveObservations(db, [2020]);
      // 150 rushing yards at PPR_SCORING.pointsPerRushingYard (0.1) each => 15 points.
      expect(observations).toEqual([{ season: 2020, position: "RB", adpRank: 3, points: 15 }]);
    });

    it("rounds a fractional published ADP rank to the nearest whole slot for the fit bucket", async () => {
      await recordPreseasonRankings(db, [ranking({ rank: 12.6 })]);
      await recordPreseasonRosters(db, [roster()]);
      const observations = await loadMarketCurveObservations(db, [2020]);
      expect(observations).toEqual([{ season: 2020, position: "RB", adpRank: 13, points: 0 }]);
    });

    it("counts a ranked player who never recorded a single stat line at ZERO, never dropping him", async () => {
      await recordPreseasonRankings(db, [ranking({ playerId: PLAYER_B, rank: 40 })]);
      await recordPreseasonRosters(db, [roster({ playerId: PLAYER_B })]);
      const observations = await loadMarketCurveObservations(db, [2020]);
      expect(observations).toEqual([{ season: 2020, position: "RB", adpRank: 40, points: 0 }]);
    });

    it("reads a season via the pbp-derived fallback when it falls in a published stats gap", async () => {
      await recordPreseasonRankings(db, [ranking({ season: 2019, playerId: PLAYER_C, rank: 3, asOf: EARLY_AUGUST(2019) })]);
      await recordPreseasonRosters(db, [roster({ season: 2019, playerId: PLAYER_C, asOf: EARLY_AUGUST(2019) })]);
      await recordObservations(db, [
        statLine({ season: 2019, week: 1, playerId: PLAYER_C, value: 200, source: DERIVED_STAT_LINE_SOURCE, asOf: GAME_DERIVED_STAMP(2019) }),
      ]);
      const observations = await loadMarketCurveObservations(db, [2019]);
      expect(observations).toEqual([{ season: 2019, position: "RB", adpRank: 3, points: 20 }]);
    });

    it("drops a ranked player whose position cannot be resolved from that season's own roster snapshot", async () => {
      await recordPreseasonRankings(db, [ranking(), ranking({ playerId: PLAYER_D, rank: 8 })]);
      await recordPreseasonRosters(db, [roster()]); // PLAYER_D never given a roster row
      const observations = await loadMarketCurveObservations(db, [2020]);
      expect(observations).toEqual([{ season: 2020, position: "RB", adpRank: 3, points: 0 }]);
    });

    it("answers empty for a season with no ADP board ingested, never a guess", async () => {
      expect(await loadMarketCurveObservations(db, [2017])).toEqual([]);
    });
  });

  describe("marketBoard", () => {
    it("resolves the board's own ADP snapshot to our player ids, priced through the fitted curve", async () => {
      await recordPreseasonRankings(db, [ranking({ rank: 3.4 })]);
      await recordPreseasonRosters(db, [roster()]);
      // A game-derived observation defines the board's own as-of moment.
      await recordObservations(db, [statLine({ value: 0 })]);

      const priors: MarketCurvePriors = { QB: [], RB: [{ adpRank: 3, points: 300 }, { adpRank: 4, points: 280 }], WR: [], TE: [] };
      const board = await marketBoard(db, 2020, priors);
      expect(board).toEqual([
        { playerId: PLAYER_A, position: "RB", adpRank: 3.4, marketPoints: marketCurve("RB", 3.4, priors) },
      ]);
    });

    it("drops a ranked row that cannot be resolved to a position, and reports the count via the returned length", async () => {
      await recordPreseasonRankings(db, [ranking(), ranking({ playerId: PLAYER_D, rank: 8 })]);
      await recordPreseasonRosters(db, [roster()]); // PLAYER_D carries no roster row for 2020
      await recordObservations(db, [statLine({ value: 0 })]);

      const board = await marketBoard(db, 2020);
      expect(board).toHaveLength(1);
      expect(board[0]!.playerId).toBe(PLAYER_A);
    });

    it("answers empty when the store holds no ADP board for the season, never a guess", async () => {
      await recordObservations(db, [statLine({ season: 2021, value: 0, asOf: GAME_DERIVED_STAMP(2021) })]);
      expect(await marketBoard(db, 2021)).toEqual([]);
    });
  });
});
