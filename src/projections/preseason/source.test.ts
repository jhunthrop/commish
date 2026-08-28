import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { recordNflPlayers } from "../universe";
import { PARTICIPATION_METRICS, NFLVERSE_SOURCE } from "../nflverse/map";
import { week1RosterAsOf } from "../nflverse/rosters";
import { STAT_LINE_SOURCE, statMetricName } from "../lines";
import { recordObservations, type PlayerWeekObservation } from "../store";
import { recordPreseasonRosters } from "./store";
import { FITTED_MODEL } from "../model/source";
import { FITTED_AVAILABILITY_PRIORS, FITTED_DEPTH_PRIORS, FITTED_ROOKIE_PRIORS } from "./fitted";
import {
  ALL_PRESEASON_FEATURES,
  loadPreseason,
  preseasonCandidates,
  preseasonMomentFor,
  rookieSegmentFor,
  type PreseasonPriors,
} from "./source";

/**
 * STRICT WEEK-ZERO DISCIPLINE, TESTED THE ONLY WAY IT CAN BE.
 *
 * This is the leakage rule at its most dangerous, because offseason data is messy and dates are
 * easy to lose. A leak here would not fail anything — it would simply make a backtested board look
 * brilliant, and every number the phase published would be a lie nobody could see.
 *
 * So the load-bearing test is the structural one model v1 relies on, moved to the preseason: a
 * board is IDENTICAL before and after the season it predicts is written into the store with wildly
 * different numbers. A model that reads the season it is predicting cannot pass it, and no unit
 * test of any individual function would notice.
 */
const db = createTestDb();

const PRIORS: PreseasonPriors = {
  model: FITTED_MODEL,
  availability: FITTED_AVAILABILITY_PRIORS,
  rookies: FITTED_ROOKIE_PRIORS,
  depth: FITTED_DEPTH_PRIORS,
};

const VETERAN = "00-0000001";
const ROOKIE = "00-0000002";
const PRIOR_SEASON_LANDED = new Date("2024-01-08T00:00:00.000Z");
const TARGET_SEASON_LANDED = new Date("2024-09-10T00:00:00.000Z");

function observation(overrides: Partial<PlayerWeekObservation> & Pick<PlayerWeekObservation, "metric" | "value">): PlayerWeekObservation {
  return {
    season: 2023,
    week: 1,
    playerId: VETERAN,
    source: NFLVERSE_SOURCE.snapCounts,
    asOf: PRIOR_SEASON_LANDED,
    ...overrides,
  };
}

/** One player-week of usage plus the outcome that goes with it, which layer 2 needs to see together. */
function playerWeek(season: number, week: number, playerId: string, asOf: Date, scale: number): readonly PlayerWeekObservation[] {
  const usage: readonly [string, number][] = [
    [PARTICIPATION_METRICS.offensiveSnaps, 55 * scale],
    [PARTICIPATION_METRICS.teamOffensiveSnaps, 65],
    [PARTICIPATION_METRICS.targets, 9 * scale],
    [PARTICIPATION_METRICS.teamTargets, 34],
    [PARTICIPATION_METRICS.carries, 1],
    [PARTICIPATION_METRICS.teamCarries, 26],
    [PARTICIPATION_METRICS.passAttempts, 0],
    [PARTICIPATION_METRICS.teamPassAttempts, 34],
  ];
  const outcome: readonly [string, number][] = [
    [statMetricName("receptions"), 6 * scale],
    [statMetricName("receivingYards"), 78 * scale],
    [statMetricName("receivingTouchdowns"), 0.5 * scale],
  ];
  return [
    ...usage.map(([metric, value]) =>
      observation({ season, week, playerId, asOf, metric, value, source: NFLVERSE_SOURCE.snapCounts }),
    ),
    ...outcome.map(([metric, value]) =>
      observation({ season, week, playerId, asOf, metric, value, source: STAT_LINE_SOURCE }),
    ),
  ];
}

async function seedPriorSeason(): Promise<void> {
  await recordNflPlayers(db, [
    { id: VETERAN, pfrId: "Vete01", name: "Vera Veteran", position: "WR", latestTeam: "BUF", rookieSeason: 2020, lastSeason: 2024 },
    { id: ROOKIE, pfrId: "Rook01", name: "Rory Rookie", position: "WR", latestTeam: "BUF", rookieSeason: 2024, lastSeason: 2024 },
  ]);
  const rows: PlayerWeekObservation[] = [];
  for (let week = 1; week <= 17; week += 1) rows.push(...playerWeek(2023, week, VETERAN, PRIOR_SEASON_LANDED, 1));
  await recordObservations(db, rows);
  await recordPreseasonRosters(db, [
    {
      season: 2024,
      team: "BUF",
      playerId: VETERAN,
      position: "WR",
      status: "active",
      birthDate: "1998-04-08",
      draftYear: 2020,
      draftPick: 17,
      draftClub: "BUF",
      asOf: week1RosterAsOf(2024),
    },
    {
      season: 2024,
      team: "BUF",
      playerId: ROOKIE,
      position: "WR",
      status: "active",
      birthDate: "2002-06-01",
      draftYear: 2024,
      draftPick: 12,
      draftClub: "BUF",
      asOf: week1RosterAsOf(2024),
    },
  ]);
}

/** The target season, written with numbers nothing preseason could possibly have known. */
async function seedTargetSeason(scale: number): Promise<void> {
  const rows: PlayerWeekObservation[] = [];
  for (let week = 1; week <= 17; week += 1) {
    rows.push(...playerWeek(2024, week, VETERAN, TARGET_SEASON_LANDED, scale));
    rows.push(...playerWeek(2024, week, ROOKIE, TARGET_SEASON_LANDED, scale));
  }
  await recordObservations(db, rows);
}

beforeEach(async () => {
  await truncateAll(db);
  await seedPriorSeason();
  await seedTargetSeason(1);
});

describe("preseasonMomentFor", () => {
  it("is strictly BEFORE the earliest thing the season produced, not at it", async () => {
    const moment = await preseasonMomentFor(db, 2024);
    expect(moment.getTime()).toBe(TARGET_SEASON_LANDED.getTime() - 1);
  });

  it("refuses a season the store does not hold rather than defaulting to a date", async () => {
    await expect(preseasonMomentFor(db, 2019)).rejects.toThrow(/holds no game-derived observations for 2019/);
  });
});

describe("loadPreseason", () => {
  it("reads the prior season and NOTHING from the season being predicted", async () => {
    const inputs = await loadPreseason(db, 2024);
    expect(inputs.usage.length).toBeGreaterThan(0);
    expect(inputs.usage.every((row) => row.season < 2024)).toBe(true);
    expect(inputs.history.every((row) => row.season < 2024)).toBe(true);
  });

  it("reads the week-one roster, which is the one fact about the season it IS allowed to see", async () => {
    const inputs = await loadPreseason(db, 2024);
    expect(inputs.roster.map((row) => row.playerId).sort()).toEqual([VETERAN, ROOKIE].sort());
  });

  it("refuses a season with no week-one roster rather than building half a board", async () => {
    // 2023 is in the store as history and has no roster of its own, which is exactly the shape an
    // operator hits when the participation backfill has run and the preseason ingestion has not.
    await expect(loadPreseason(db, 2023)).rejects.toThrow(/no 2023 week-one roster/);
  });
});

describe("the leakage guarantee", () => {
  it("PRODUCES AN IDENTICAL BOARD BEFORE AND AFTER THE SEASON IS WRITTEN WITH DIFFERENT NUMBERS", async () => {
    // The structural test `src/projections/model/source.test.ts` holds the weekly model to, moved to
    // the preseason. Nothing else in the suite would catch a leak: a board that read the season it
    // predicts would simply score better, and every unit test below it would still pass.
    const before = preseasonCandidates(await loadPreseason(db, 2024), ALL_PRESEASON_FEATURES, PRIORS);

    // Restate every week of 2024 at four times the volume, stamped when it really landed.
    const rows: PlayerWeekObservation[] = [];
    for (let week = 1; week <= 17; week += 1) {
      rows.push(...playerWeek(2024, week, VETERAN, new Date(TARGET_SEASON_LANDED.getTime() + 86_400_000), 4));
    }
    await recordObservations(db, rows);

    const after = preseasonCandidates(await loadPreseason(db, 2024), ALL_PRESEASON_FEATURES, PRIORS);
    expect(after).toEqual(before);
  });
});

describe("preseasonCandidates", () => {
  it("puts a veteran on the board with a per-game line and a games distribution", async () => {
    const candidates = preseasonCandidates(await loadPreseason(db, 2024), ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;
    expect(veteran.position).toBe("WR");
    expect(veteran.team).toBe("BUF");
    expect(veteran.perGame.receivingYards).toBeGreaterThan(0);
    expect(veteran.games.expected).toBeGreaterThan(0);
    expect(veteran.games.expected).toBeLessThan(17);
    expect(veteran.reasons.some((reason) => reason.code === "availability")).toBe(true);
  });

  it("puts a ROOKIE on the board, whom the weekly model cannot project at all", async () => {
    const inputs = await loadPreseason(db, 2024);
    const withRookies = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const without = preseasonCandidates(inputs, { ...ALL_PRESEASON_FEATURES, rookies: false }, PRIORS);
    expect(withRookies.map((candidate) => candidate.playerId)).toContain(ROOKIE);
    expect(without.map((candidate) => candidate.playerId)).not.toContain(ROOKIE);
    expect(rookieSegmentFor(inputs).has(ROOKIE)).toBe(true);
  });

  it("gives everybody seventeen games when availability is switched off, which is the ablation's before arm", async () => {
    const candidates = preseasonCandidates(await loadPreseason(db, 2024), { ...ALL_PRESEASON_FEATURES, availability: false }, PRIORS);
    for (const candidate of candidates) {
      expect(candidate.games.expected).toBe(17);
      expect(candidate.reasons.some((reason) => reason.code === "availability")).toBe(false);
    }
  });

  it("is sorted by player id, so two runs over the same store agree exactly", async () => {
    const inputs = await loadPreseason(db, 2024);
    const first = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    expect(preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS)).toEqual(first);
    expect(first.map((candidate) => candidate.playerId)).toEqual([...first.map((candidate) => candidate.playerId)].sort());
  });

  it("leaves a man nobody rostered off the board entirely", async () => {
    // He is in the universe and has a full prior season, and he is still not on anybody's
    // week-one roster. A board that carried him would be offering a player who does not exist.
    await recordPreseasonRosters(db, [
      {
        season: 2024,
        team: "BUF",
        playerId: VETERAN,
        position: "WR",
        status: "off_roster",
        birthDate: "1998-04-08",
        draftYear: 2020,
        draftPick: 17,
        draftClub: "BUF",
        asOf: new Date(week1RosterAsOf(2024).getTime() + 1),
      },
    ]);
    const candidates = preseasonCandidates(await loadPreseason(db, 2024), ALL_PRESEASON_FEATURES, PRIORS);
    expect(candidates.map((candidate) => candidate.playerId)).not.toContain(VETERAN);
  });
});
