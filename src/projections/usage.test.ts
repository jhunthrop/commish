import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Position } from "@/domain/player";
import { PARTICIPATION_METRICS, NFLVERSE_SOURCE } from "./nflverse/map";
import { PBP_PLAYER_METRICS, PBP_PLAYER_SOURCE } from "./nflverse/pbp-players";
import { recordObservations, type PlayerWeekObservation } from "./store";
import { recordNflPlayers } from "./universe";
import { admitTouchesAsOpportunity, usageAsOf } from "./usage";

/**
 * ABSENCE STAYS ABSENCE — the seam the final fix round closed (review finding M1).
 *
 * `usageAsOf` used to read every participation metric through `entry.metrics.get(metric) ?? 0`,
 * which turns "this season's weekly stats file was never published, so the backfill deliberately
 * WITHHELD these metrics rather than writing false zeros" into "observed zero". Every fully
 * published season carries all eight participation metrics on every player-week that has the snap
 * denominator (verified against the live store: zero missing on 2013-2018 and 2020-2024), so the
 * distinction is invisible until a GAP season arrives — which is exactly where it decides whether a
 * live board's model arm has evidence or fabricates the absence of it.
 */
const db = createTestDb();

const WR = "00-0000001";
const QB = "00-0000002";
const AS_OF = new Date("2026-01-08T00:00:00.000Z");
const READ = { week: { from: 1, to: 22 }, asOf: new Date("2026-06-01T00:00:00.000Z") } as const;

function observation(overrides: Partial<PlayerWeekObservation> & Pick<PlayerWeekObservation, "metric" | "value">): PlayerWeekObservation {
  return { season: 2025, week: 1, playerId: WR, source: NFLVERSE_SOURCE.snapCounts, asOf: AS_OF, ...overrides };
}

/** The shape a PUBLISHED season takes: snaps and the weekly stats file's participation counts. */
function publishedWeek(playerId: string, week: number): readonly PlayerWeekObservation[] {
  const pairs: readonly (readonly [string, number, string])[] = [
    [PARTICIPATION_METRICS.offensiveSnaps, 55, NFLVERSE_SOURCE.snapCounts],
    [PARTICIPATION_METRICS.teamOffensiveSnaps, 65, NFLVERSE_SOURCE.snapCounts],
    [PARTICIPATION_METRICS.targets, 9, NFLVERSE_SOURCE.playerWeek],
    [PARTICIPATION_METRICS.teamTargets, 34, NFLVERSE_SOURCE.playerWeek],
    [PARTICIPATION_METRICS.carries, 1, NFLVERSE_SOURCE.playerWeek],
    [PARTICIPATION_METRICS.teamCarries, 26, NFLVERSE_SOURCE.playerWeek],
    [PARTICIPATION_METRICS.passAttempts, 0, NFLVERSE_SOURCE.playerWeek],
    [PARTICIPATION_METRICS.teamPassAttempts, 34, NFLVERSE_SOURCE.playerWeek],
  ];
  return pairs.map(([metric, value, source]) => observation({ playerId, week, metric, value, source }));
}

/** The shape a GAP season takes: the snap-counts file and the play-by-play, and nothing else — the
 *  literal 2025 inventory (`nflverse_snap_counts` plus `nflverse_pbp_player`, zero rows under the
 *  weekly-stats source). */
function gapWeek(playerId: string, week: number, carries: number, targets: number): readonly PlayerWeekObservation[] {
  const snaps: readonly (readonly [string, number])[] = [
    [PARTICIPATION_METRICS.offensiveSnaps, 55],
    [PARTICIPATION_METRICS.teamOffensiveSnaps, 65],
  ];
  const touches: readonly (readonly [string, number])[] = [
    [PBP_PLAYER_METRICS.carries, carries],
    [PBP_PLAYER_METRICS.targets, targets],
    [PBP_PLAYER_METRICS.redZoneCarries, 0],
    [PBP_PLAYER_METRICS.redZoneTargets, 1],
    [PBP_PLAYER_METRICS.insideTenCarries, 0],
    [PBP_PLAYER_METRICS.insideTenTargets, 0],
    [PBP_PLAYER_METRICS.airYards, 70],
    [PBP_PLAYER_METRICS.airYardTargets, targets],
  ];
  return [
    ...snaps.map(([metric, value]) => observation({ playerId, week, metric, value, source: NFLVERSE_SOURCE.snapCounts })),
    ...touches.map(([metric, value]) => observation({ playerId, week, metric, value, source: PBP_PLAYER_SOURCE })),
  ];
}

const POSITIONS: ReadonlyMap<string, Position> = new Map([
  [WR, "WR"],
  [QB, "QB"],
]);

beforeEach(async () => {
  await truncateAll(db);
  await recordNflPlayers(db, [
    { id: WR, espnId: null, pfrId: "Wide01", name: "Wanda Wideout", position: "WR", latestTeam: "BUF", rookieSeason: 2020, lastSeason: 2025 },
    { id: QB, espnId: null, pfrId: "Quar01", name: "Quinn Quarterback", position: "QB", latestTeam: "BUF", rookieSeason: 2020, lastSeason: 2025 },
  ]);
});

describe("usageAsOf — a withheld metric is absent, never an observed zero", () => {
  it("reads a published week's counts exactly as before, with nothing null", async () => {
    await recordObservations(db, [...publishedWeek(WR, 1)]);

    const [row] = await usageAsOf(db, { season: 2025, ...READ });

    expect(row).toBeDefined();
    expect(row!.targets).toBe(9);
    expect(row!.teamTargets).toBe(34);
    expect(row!.carries).toBe(1);
    expect(row!.teamCarries).toBe(26);
    expect(row!.passAttempts).toBe(0);
    expect(row!.teamPassAttempts).toBe(34);
    expect(row!.targetShare).toBeCloseTo(9 / 34, 10);
    expect(row!.snapShare).toBeCloseTo(55 / 65, 10);
  });

  it("leaves a gap season's WITHHELD counts null rather than synthesizing zeros", async () => {
    await recordObservations(db, [...gapWeek(WR, 1, 0, 8)]);

    const [row] = await usageAsOf(db, { season: 2025, ...READ });

    expect(row).toBeDefined();
    // The snap denominator arrived, so the week is real and its snap share is measured.
    expect(row!.snapShare).toBeCloseTo(55 / 65, 10);
    // Everything the weekly stats file would have carried is ABSENT, not zero.
    expect(row!.targets).toBeNull();
    expect(row!.carries).toBeNull();
    expect(row!.passAttempts).toBeNull();
    expect(row!.teamTargets).toBeNull();
    expect(row!.teamCarries).toBeNull();
    expect(row!.teamPassAttempts).toBeNull();
    expect(row!.targetShare).toBeNull();
    expect(row!.carryShare).toBeNull();
    expect(row!.passAttemptShare).toBeNull();
    // The play-by-play's own counts came through untouched.
    expect(row!.touches).not.toBeNull();
    expect(row!.touches!.targets).toBe(8);
  });
});

describe("admitTouchesAsOpportunity — the play-by-play stands in for the counts the gap season withheld", () => {
  it("fills targets and carries from the touches for a non-quarterback, and leaves the rest absent", async () => {
    await recordObservations(db, [...gapWeek(WR, 1, 2, 8)]);
    const rows = await usageAsOf(db, { season: 2025, ...READ });

    const [row] = admitTouchesAsOpportunity(rows, POSITIONS);

    expect(row!.targets).toBe(8);
    expect(row!.carries).toBe(2);
    // No substitute exists for a pass attempt, and no team total can come off a player-level feed.
    expect(row!.passAttempts).toBeNull();
    expect(row!.teamTargets).toBeNull();
    expect(row!.teamCarries).toBeNull();
    expect(row!.teamPassAttempts).toBeNull();
    // A share still needs its team denominator, which the gap season does not have.
    expect(row!.targetShare).toBeNull();
  });

  it("refuses the carry substitution for a QUARTERBACK, whose scrambles the pbp carry count excludes", async () => {
    await recordObservations(db, [...gapWeek(QB, 1, 4, 0)]);
    const rows = await usageAsOf(db, { season: 2025, ...READ });

    const [row] = admitTouchesAsOpportunity(rows, POSITIONS);

    expect(row!.carries).toBeNull();
    expect(row!.targets).toBe(0);
  });

  it("leaves a PUBLISHED week untouched — the substitution only ever fills an absence", async () => {
    await recordObservations(db, [...publishedWeek(WR, 1)]);
    const rows = await usageAsOf(db, { season: 2025, ...READ });

    expect(admitTouchesAsOpportunity(rows, POSITIONS)).toEqual(rows);
  });
});
