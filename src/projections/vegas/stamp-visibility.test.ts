import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { recordNflPlayers } from "../universe";
import { week1RosterAsOf } from "../nflverse/rosters";
import { STAT_LINE_SOURCE, statMetricName } from "../lines";
import { recordObservations, type PlayerWeekObservation } from "../store";
import { recordPreseasonRosters } from "../preseason/store";
import { liveMomentFor, loadPreseason, replayMomentFor } from "../preseason/source";
import { recordTeamObservations, teamObservationsAsOf } from "../team-store";
import { indexTeamMetrics } from "../team-context";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { parseWinTotalsCsv, VEGAS_METRICS, VEGAS_SOURCE, winTotalObservations } from "./ingest";

/**
 * TASK 2's SPEC-BINDING AUDIT — the four claims `task-2-brief.md` names, each proven at the exact
 * seam a real reader uses rather than asserted about the mapping function alone:
 *
 *   (a) a measurement-time read for a historical season SEES its win total,
 *   (b) a replay moment for 2021-2024 SEES it,
 *   (c) the LIVE 2026 moment sees the 2026 row through the ORDINARY as-of gate, with no carve-out —
 *       and, contrasted directly, a hypothetical GAME-DERIVED row for the same season still trips
 *       the live guard, proving the vegas row's admission is not a hole in that guard,
 *   (d) a season with no CSV row reads null.
 */
const db = createTestDb();
const HEADER = "season,team,win_total,over_price,under_price,actual_wins,source,source_date";
const VETERAN = "00-0009001";

function csvRows(text: string) {
  return winTotalObservations(parseWinTotalsCsv(`${HEADER}\n${text}\n`));
}

beforeEach(async () => {
  await truncateAll(db);
});

describe("(a) measurement-time read — the harness's own as-of for a fact about the past", () => {
  it("sees a historical season's win total once the harness reads far enough forward", async () => {
    await recordTeamObservations(db, csvRows("2010,CLE,8.5,-110,-110,,not_tracked,2010-08-30T00:00:00.000Z"));

    // The same convention `nflverse/ingest.ts`'s own `FAR_FUTURE` names: the honest read for a fact
    // that is entirely about a season long over is the final, corrected one, unbounded by any replay
    // moment this test would otherwise have to derive.
    const measurementAsOf = new Date("9999-12-31T00:00:00.000Z");
    const known = await teamObservationsAsOf(db, { season: 2010, week: 1, asOf: measurementAsOf, source: VEGAS_SOURCE });
    expect(known.map((row) => [row.metric, row.value]).sort()).toEqual(
      [
        [VEGAS_METRICS.winTotal, 8.5],
        [VEGAS_METRICS.overPrice, -110],
        [VEGAS_METRICS.underPrice, -110],
      ].sort(),
    );
  });
});

describe("(b) a replay moment for 2021-2024 sees the season's win total", () => {
  it.each([2021, 2022, 2023, 2024])("season %d", async (season) => {
    // A player row must exist before any player_week_observations row can reference it.
    await recordNflPlayers(db, [
      { id: VETERAN, espnId: null, pfrId: "Vete01", name: "Vera Veteran", position: "WR", latestTeam: "CLE", rookieSeason: 2018, lastSeason: 2025 },
    ]);
    // `replayMomentFor` derives from the earliest GAME-DERIVED stamp the season carries
    // (`preseasonMomentFor`), so a replay moment needs at least one such fact to exist — a single
    // in-season stat line stands in for the season having been played at all.
    const inSeason: PlayerWeekObservation = {
      season,
      week: 10,
      playerId: VETERAN,
      source: STAT_LINE_SOURCE,
      metric: statMetricName("receptions"),
      value: 4,
      asOf: new Date(Date.UTC(season, 10, 15)),
    };
    await recordObservations(db, [inSeason]);
    await recordTeamObservations(db, csvRows(`${season},CLE,8.5,-110,-110,,not_tracked,${season}-08-30T00:00:00.000Z`));

    const moment = await replayMomentFor(db, season);
    expect(moment.kind).toBe("replay");
    const known = await teamObservationsAsOf(db, { season, week: 1, asOf: moment.at, source: VEGAS_SOURCE });
    expect(known.map((row) => row.metric)).toEqual(
      expect.arrayContaining([VEGAS_METRICS.winTotal, VEGAS_METRICS.overPrice, VEGAS_METRICS.underPrice]),
    );
  });
});

describe("(c) the live 2026 moment — ordinary as-of gate, no carve-out; the live guard still fires on a real game-derived row", () => {
  const LIVE_SEASON = 2026;
  const FIRST_KICKOFF = new Date("2026-09-10T23:20:00.000Z");
  const clockBeforeKickoff: Clock = { now: () => new Date(FIRST_KICKOFF.getTime() - 24 * 60 * 60 * 1000).toISOString() };

  async function seedLiveRoster(): Promise<void> {
    await recordNflPlayers(db, [
      { id: VETERAN, espnId: null, pfrId: "Vete01", name: "Vera Veteran", position: "WR", latestTeam: "BUF", rookieSeason: 2020, lastSeason: 2025 },
    ]);
    await recordPreseasonRosters(db, [
      {
        season: LIVE_SEASON,
        team: "BUF",
        playerId: VETERAN,
        position: "WR",
        status: "active",
        birthDate: "1998-04-08",
        draftYear: 2020,
        draftPick: 17,
        draftClub: "BUF",
        asOf: week1RosterAsOf(LIVE_SEASON),
      },
    ]);
  }

  async function seedFirstKickoff(): Promise<void> {
    await recordTeamObservations(db, [
      {
        season: LIVE_SEASON,
        week: 1,
        team: "BUF",
        source: SCHEDULE_SOURCE.kickoff,
        metric: SCHEDULE_METRICS.kickoffInstant,
        value: 1,
        asOf: FIRST_KICKOFF,
      },
    ]);
  }

  async function seedVegasRow(): Promise<void> {
    // The real 2025/2026 shape (`data/win-totals/README.md`): draftkings, stamped mid-August.
    await recordTeamObservations(db, csvRows("2026,BUF,9.5,-110,-110,,draftkings,2026-08-15T00:00:00.000Z"));
  }

  it("the 2026-stamped vegas row is visible on a live board — no throw, no special case", async () => {
    await seedLiveRoster();
    await seedFirstKickoff();
    await seedVegasRow();

    const liveMoment = await liveMomentFor(db, LIVE_SEASON, clockBeforeKickoff);
    const inputs = await loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment });
    expect(inputs.momentKind).toBe("live");
    const vegasRows = inputs.teamObservations.filter((row) => row.source === VEGAS_SOURCE && row.team === "BUF");
    expect(vegasRows.map((row) => [row.metric, row.value]).sort()).toEqual(
      [
        [VEGAS_METRICS.winTotal, 9.5],
        [VEGAS_METRICS.overPrice, -110],
        [VEGAS_METRICS.underPrice, -110],
      ].sort(),
    );
  });

  it("the SAME live board still THROWS when a hypothetical game-derived row exists for 2026 — the vegas row is not a hole in the guard", async () => {
    await seedLiveRoster();
    await seedFirstKickoff();
    await seedVegasRow();
    await recordObservations(db, [
      {
        season: LIVE_SEASON,
        week: 1,
        playerId: VETERAN,
        source: STAT_LINE_SOURCE,
        metric: statMetricName("receptions"),
        value: 4,
        asOf: new Date(FIRST_KICKOFF.getTime() - 5 * 24 * 60 * 60 * 1000),
      },
    ]);

    const liveMoment = await liveMomentFor(db, LIVE_SEASON, clockBeforeKickoff);
    await expect(loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment })).rejects.toThrow(/live board/i);
    await expect(loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment })).rejects.toThrow(/game-derived/i);
  });
});

describe("(d) a season with no CSV row reads null, never a default", () => {
  it("teamObservationsAsOf returns nothing for a season the vegas ingest never touched", async () => {
    await recordTeamObservations(db, csvRows("2010,CLE,8.5,-110,-110,,not_tracked,2010-08-30T00:00:00.000Z"));
    const known = await teamObservationsAsOf(db, {
      season: 2005,
      week: 1,
      asOf: new Date("9999-12-31T00:00:00.000Z"),
      source: VEGAS_SOURCE,
    });
    expect(known).toEqual([]);
  });

  it("indexTeamMetrics reads null, not a default, for the same absent season", async () => {
    await recordTeamObservations(db, csvRows("2010,CLE,8.5,-110,-110,,not_tracked,2010-08-30T00:00:00.000Z"));
    const rows2010 = await teamObservationsAsOf(db, { season: 2010, week: 1, asOf: new Date("9999-12-31T00:00:00.000Z") });
    const metrics = indexTeamMetrics({ playerTeams: [], teamObservations: rows2010 });
    expect(metrics("CLE", { season: 2005, week: 1 }, VEGAS_METRICS.winTotal)).toBeNull();
  });
});
