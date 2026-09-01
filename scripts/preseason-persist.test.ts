import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { STAT_LINE_SOURCE, statMetricName } from "@/projections/lines";
import { NFLVERSE_SOURCE, PARTICIPATION_METRICS } from "@/projections/nflverse/map";
import { week1RosterAsOf } from "@/projections/nflverse/rosters";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "@/projections/nflverse/schedule";
import { BOARD_SOURCE, BOARD_SOURCE_V1_RAW, preseasonProjectionsAsOf } from "@/projections/preseason/board-store";
import { recordPreseasonRosters } from "@/projections/preseason/store";
import { recordObservations, type PlayerWeekObservation } from "@/projections/store";
import { recordTeamObservations } from "@/projections/team-store";
import { recordNflPlayers } from "@/projections/universe";
import { persistSeason } from "./preseason-persist";

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
