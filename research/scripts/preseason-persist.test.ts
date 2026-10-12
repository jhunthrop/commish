import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, truncateAll } from "@research/db/test-db";
import type { Clock } from "@research/domain/timing";
import { STAT_LINE_SOURCE, statMetricName } from "@research/projections/lines";
import { NFLVERSE_SOURCE, PARTICIPATION_METRICS } from "@research/projections/nflverse/map";
import { week1RosterAsOf } from "@research/projections/nflverse/rosters";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "@research/projections/nflverse/schedule";
import { BOARD_FORMAT_SPECS, BOARD_FORMATS, boardSourceFor, type BoardFormat } from "@research/projections/preseason/board-formats";
import { BOARD_SOURCE, BOARD_SOURCE_V1_RAW, preseasonProjectionsAsOf, type PreseasonProjectionRow } from "@research/projections/preseason/board-store";
import { recordPreseasonRankings, recordPreseasonRosters } from "@research/projections/preseason/store";
import { recordObservations, type PlayerWeekObservation } from "@research/projections/store";
import { recordTeamObservations } from "@research/projections/team-store";
import { recordNflPlayers } from "@research/projections/universe";
import { publishCommittedModelArtifacts } from "./lib/model-artifact-records";
import { diffReasons, persistSeason } from "./preseason-persist";

/**
 * I5 (Task 4 fix round 2) — THE ORDERING GUARANTEE ITSELF, proven end to end against a real
 * database rather than assumed from reading the call order in `persistSeason`: when the degeneracy
 * guard fires while building the BLENDED board, the RAW (v1) board must never have been written
 * either. Before this fix, `main`'s loop built and wrote v1 FIRST, so a degenerate live market left
 * v1's rows on record even though the run as a whole "failed" — this is the regression that proof
 * closes.
 */
describe("persistSeason — the degeneracy guard fires before ANY write, v1 included (Task 4 fix round 2, I5)", () => {
  const db = createTestDb();
  const SEASON = 2026;
  const FIRST_KICKOFF = new Date("2026-09-04T23:20:00.000Z");
  const clockBeforeKickoff: Clock = { now: () => new Date(FIRST_KICKOFF.getTime() - 24 * 60 * 60 * 1000).toISOString() };
  const VETERAN = "00-0000001";

  /** Enough usage/outcome history that `preseasonCandidates` actually emits a row for VETERAN —
   *  the point of this test is "v1 must not write a REAL row," which an always-empty raw board
   *  cannot prove. */
  function usageWeek(season: number, week: number, asOf: Date): readonly PlayerWeekObservation[] {
    const base = { season, week, playerId: VETERAN, asOf } as const;
    return [
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.offensiveSnaps, value: 55 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.teamOffensiveSnaps, value: 65 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.targets, value: 9 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.teamTargets, value: 34 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.carries, value: 1 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.teamCarries, value: 26 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.passAttempts, value: 0 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.teamPassAttempts, value: 34 },
      { ...base, source: STAT_LINE_SOURCE, metric: statMetricName("receptions"), value: 6 },
      { ...base, source: STAT_LINE_SOURCE, metric: statMetricName("receivingYards"), value: 78 },
      { ...base, source: STAT_LINE_SOURCE, metric: statMetricName("receivingTouchdowns"), value: 0.5 },
    ];
  }

  beforeEach(async () => {
    await truncateAll(db);
    // The persist reads its fitted tables from the model artifact store, so the committed records
    // land first, exactly as `npm run artifacts:publish` lands them in production.
    await publishCommittedModelArtifacts(db);
    await recordNflPlayers(db, [
      { id: VETERAN, espnId: null, pfrId: "Vete01", name: "Vera Veteran", position: "WR", latestTeam: "BUF", rookieSeason: 2020, lastSeason: 2025 },
    ]);
    const usage: PlayerWeekObservation[] = [];
    for (const season of [2023, 2024, 2025]) {
      for (let week = 1; week <= 17; week += 1) {
        usage.push(...usageWeek(season, week, new Date(`${season}-12-01T00:00:00.000Z`)));
      }
    }
    await recordObservations(db, usage);
    await recordPreseasonRosters(db, [
      {
        season: SEASON,
        team: "BUF",
        playerId: VETERAN,
        position: "WR",
        status: "active",
        birthDate: "1998-04-08",
        draftYear: 2020,
        draftPick: 17,
        draftClub: "BUF",
        asOf: week1RosterAsOf(SEASON),
      },
    ]);
    await recordTeamObservations(db, [
      {
        season: SEASON,
        week: 1,
        team: "BUF",
        source: SCHEDULE_SOURCE.kickoff,
        metric: SCHEDULE_METRICS.kickoffInstant,
        value: 1,
        asOf: FIRST_KICKOFF,
      },
    ]);
    // No ADP ingested at all for SEASON — the degeneracy guard's "ZERO listed market players"
    // branch, which fires unconditionally regardless of what the model side of the board holds.
  });

  it("THROWS via persistSeason, and writes NOTHING under either source — not even v1", async () => {
    await expect(persistSeason(db, SEASON, clockBeforeKickoff, new Map())).rejects.toThrow(/ZERO listed market players/);

    const FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");
    const v1Rows = await preseasonProjectionsAsOf(db, { season: SEASON, source: BOARD_SOURCE_V1_RAW, asOf: FAR_FUTURE });
    const blendRows = await preseasonProjectionsAsOf(db, { season: SEASON, source: BOARD_SOURCE, asOf: FAR_FUTURE });
    expect(v1Rows).toHaveLength(0);
    expect(blendRows).toHaveLength(0);
  });
});

/**
 * THE LOUD WARNING (fix round 1, MEDIUM 1b) — a LIVE board whose props anchor resolves to zero
 * players must never fall back to ADP-only silently. A full happy-path persist (real ADP coverage,
 * so the run actually succeeds and writes a board) with NO props archive at all is the scenario:
 * the ADP-only fallback happens correctly, but only the warning makes it visible.
 */
describe("persistSeason — the props-anchor warning fires on a LIVE board with an empty anchor (fix round 1, MEDIUM 1b)", () => {
  const db = createTestDb();
  const SEASON = 2026;
  const FIRST_KICKOFF = new Date("2026-09-04T23:20:00.000Z");
  const clockBeforeKickoff: Clock = { now: () => new Date(FIRST_KICKOFF.getTime() - 24 * 60 * 60 * 1000).toISOString() };
  const VETERAN = "00-0000001";
  const RANKING_ASOF = new Date(FIRST_KICKOFF.getTime() - 48 * 60 * 60 * 1000);

  function usageWeek(season: number, week: number, asOf: Date): readonly PlayerWeekObservation[] {
    const base = { season, week, playerId: VETERAN, asOf } as const;
    return [
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.offensiveSnaps, value: 55 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.teamOffensiveSnaps, value: 65 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.targets, value: 9 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.teamTargets, value: 34 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.carries, value: 1 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.teamCarries, value: 26 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.passAttempts, value: 0 },
      { ...base, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.teamPassAttempts, value: 34 },
      { ...base, source: STAT_LINE_SOURCE, metric: statMetricName("receptions"), value: 6 },
      { ...base, source: STAT_LINE_SOURCE, metric: statMetricName("receivingYards"), value: 78 },
      { ...base, source: STAT_LINE_SOURCE, metric: statMetricName("receivingTouchdowns"), value: 0.5 },
    ];
  }

  beforeEach(async () => {
    await truncateAll(db);
    // The persist reads its fitted tables from the model artifact store, so the committed records
    // land first, exactly as `npm run artifacts:publish` lands them in production.
    await publishCommittedModelArtifacts(db);
    // VETERAN plus enough OTHER real WRs, listed on the ADP market, to clear
    // `MINIMUM_LISTED_PER_POSITION` (5) at WR — the market side `assertLiveMarketCoverage` checks —
    // with NO `player_prop_observations` archived at all, ever: the props-anchor null cell.
    const fillerIds = Array.from({ length: 5 }, (_, index) => `filler-${index}`);
    await recordNflPlayers(db, [
      { id: VETERAN, espnId: null, pfrId: "Vete01", name: "Vera Veteran", position: "WR", latestTeam: "BUF", rookieSeason: 2020, lastSeason: 2025 },
      ...fillerIds.map((id, index) => ({
        id,
        espnId: null,
        pfrId: `Fill${index}`,
        name: `Filler ${index}`,
        position: "WR",
        latestTeam: "BUF",
        rookieSeason: 2020,
        lastSeason: 2025,
      })),
    ]);
    const usage: PlayerWeekObservation[] = [];
    for (const season of [2023, 2024, 2025]) {
      for (let week = 1; week <= 17; week += 1) {
        usage.push(...usageWeek(season, week, new Date(`${season}-12-01T00:00:00.000Z`)));
      }
    }
    await recordObservations(db, usage);
    await recordPreseasonRosters(db, [
      {
        season: SEASON,
        team: "BUF",
        playerId: VETERAN,
        position: "WR",
        status: "active",
        birthDate: "1998-04-08",
        draftYear: 2020,
        draftPick: 17,
        draftClub: "BUF",
        asOf: week1RosterAsOf(SEASON),
      },
      ...fillerIds.map((id, index) => ({
        season: SEASON,
        team: "BUF",
        playerId: id,
        position: "WR",
        status: "active" as const,
        birthDate: "1999-01-01",
        draftYear: 2021,
        draftPick: 50 + index,
        draftClub: "BUF",
        asOf: week1RosterAsOf(SEASON),
      })),
    ]);
    // Every format's own feed lists the same six receivers (the scoring-formats round): each blended
    // leg anchors to its own source, so a leg with no board of its own would hit the degeneracy
    // guard exactly as a PPR board with no ADP would.
    await recordPreseasonRankings(
      db,
      BOARD_FORMATS.flatMap((format) => [
        { season: SEASON, source: BOARD_FORMAT_SPECS[format].adpSource, playerId: VETERAN, rank: 10, asOf: RANKING_ASOF },
        ...fillerIds.map((id, index) => ({ season: SEASON, source: BOARD_FORMAT_SPECS[format].adpSource, playerId: id, rank: 20 + index, asOf: RANKING_ASOF })),
      ]),
    );
    await recordTeamObservations(db, [
      {
        season: SEASON,
        week: 1,
        team: "BUF",
        source: SCHEDULE_SOURCE.kickoff,
        metric: SCHEDULE_METRICS.kickoffInstant,
        value: 1,
        asOf: FIRST_KICKOFF,
      },
    ]);
    // No `player_prop_observations` recorded at all — the props anchor is the null cell for every
    // player, which is what this test is verifying gets a loud warning rather than silence.
  });

  it("logs the loud warning and still persists the board (ADP-only is a real fallback, not a refusal)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await persistSeason(db, SEASON, clockBeforeKickoff, new Map());
      expect(warnSpy).toHaveBeenCalledWith(`props anchor: 0 players anchored for ${SEASON} — resolve has not run or the archive is empty`);

      const FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");
      const blendRows = await preseasonProjectionsAsOf(db, { season: SEASON, source: BOARD_SOURCE, asOf: FAR_FUTURE });
      expect(blendRows.length).toBeGreaterThan(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("writes all three formats' boards under their own sources, each scored under its own preset (the scoring-formats round)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await persistSeason(db, SEASON, clockBeforeKickoff, new Map());
      const FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");
      const boards = new Map<BoardFormat, readonly PreseasonProjectionRow[]>();
      for (const format of BOARD_FORMATS) {
        const rows = await preseasonProjectionsAsOf(db, { season: SEASON, source: boardSourceFor(format), asOf: FAR_FUTURE });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((row) => row.momentKind === "live")).toBe(true);
        boards.set(format, rows);
      }
      expect(boardSourceFor("ppr")).toBe(BOARD_SOURCE);
      // The veteran catches six a game: a point apiece under PPR, half under half PPR, nothing
      // under standard. The three boards are the same model scored three ways, in that order.
      const veteran = (format: BoardFormat) => boards.get(format)!.find((row) => row.playerId === VETERAN)!.projectedPoints;
      expect(veteran("half")).toBeLessThan(veteran("ppr"));
      expect(veteran("std")).toBeLessThan(veteran("half"));
    } finally {
      warnSpy.mockRestore();
    }
  });
});

/**
 * --diff-reasons (dossier-voice round, task 7) — the counting itself, pure, so the coordinator can
 * trust the number the script prints before running a re-persist against production.
 */
describe("diffReasons", () => {
  const cliff = (playersLeftInTier: number, dropToNextTier: number) =>
    [{ code: "tier_cliff", playersLeftInTier, dropToNextTier } as const];

  it("counts a payload that moved as changed, not as an add and a drop", () => {
    const stored = new Map([["p1", cliff(1, 3.2)]]);
    const fresh = new Map([["p1", cliff(4, 3.2)]]);
    expect(diffReasons(stored, fresh)).toEqual([{ code: "tier_cliff", added: 0, removed: 0, changed: 1, unchanged: 0 }]);
  });

  it("counts a reason the new rule no longer fires as removed", () => {
    const stored = new Map([["p1", cliff(1, 3.2)], ["p2", cliff(2, 20.9)]]);
    const fresh = new Map([["p1", []], ["p2", cliff(2, 20.9)]]);
    expect(diffReasons(stored, fresh)).toEqual([{ code: "tier_cliff", added: 0, removed: 1, changed: 0, unchanged: 1 }]);
  });

  it("counts a player the stored board never carried at all as an add", () => {
    const stored = new Map<string, readonly { readonly code: string }[]>();
    const fresh = new Map([["p1", cliff(2, 20.9)]]);
    expect(diffReasons(stored as never, fresh)).toEqual([{ code: "tier_cliff", added: 1, removed: 0, changed: 0, unchanged: 0 }]);
  });

  it("reports one row per code, sorted, over both boards' codes", () => {
    const stored = new Map([["p1", [{ code: "scarcity", positionRank: 4, replacementLevel: 140 } as const]]]);
    const fresh = new Map([["p1", [{ code: "scarcity", positionRank: 4, replacementLevel: 140 } as const, ...cliff(2, 20.9)]]]);
    expect(diffReasons(stored, fresh).map((diff) => diff.code)).toEqual(["scarcity", "tier_cliff"]);
  });
});
