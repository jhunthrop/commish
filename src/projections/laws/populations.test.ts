import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers } from "@/db/schema";
import { STAT_FIELDS, type StatLine } from "@/domain/player";
import { statLineObservations } from "../nflverse/stat-lines";
import type { SeasonStatLine } from "../lines";
import { STAT_LINE_SOURCE } from "../lines";
import { PARTICIPATION_METRICS } from "../nflverse/map";
import { COACH_METRICS } from "../nflverse/coaches";
import { schedulePublishedAsOf, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { recordObservations } from "../store";
import { recordPlayerTeams, recordTeamObservations } from "../team-store";
import { recordPreseasonRosters } from "../preseason/store";
import { LAW_SPECS } from "./populations";

/**
 * DB-BACKED FIXTURES FOR THE SIX LAW POPULATIONS, following `backtest.test.ts`'s style: one test
 * database, `truncateAll` between tests, hand-built rows stamped at the exact moments that matter.
 *
 * Season N is 2023, season N+1 is 2024, and `GATE` is the as-of every builder reads season N
 * through — `schedulePublishedAsOf(2024)`. Every "does not leak" test adds a fact that is either
 * about the wrong season or stamped after `GATE`, and asserts the population's `condition` is
 * unmoved — the same proof `backtest.test.ts` runs for a late stat correction.
 */

const db = createTestDb();

const N = 2023;
const N1 = 2024;
const GATE = schedulePublishedAsOf(N1);
const BEFORE_GATE = new Date("2023-09-01T00:00:00.000Z");
const AFTER_GATE = new Date("2024-06-01T00:00:00.000Z");

function specFor(id: string) {
  const spec = LAW_SPECS.find((entry) => entry.id === id);
  if (spec === undefined) throw new Error(`No LawSpec registered for ${id}`);
  return spec;
}

function line(season: number, week: number, playerId: string, over: Partial<StatLine>, asOf: Date): SeasonStatLine {
  return {
    season,
    asOf,
    line: {
      playerId,
      week,
      ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
      ...over,
    },
  };
}

async function storeLines(lines: readonly SeasonStatLine[]): Promise<void> {
  await recordObservations(db, statLineObservations(lines));
}

interface ParticipationRow {
  readonly season: number;
  readonly week: number;
  readonly playerId: string;
  readonly metric: string;
  readonly value: number;
  readonly asOf: Date;
}

async function storeParticipation(rows: readonly ParticipationRow[]): Promise<void> {
  await recordObservations(db, rows.map((row) => ({ ...row, source: STAT_LINE_SOURCE })));
}

interface CoachRow {
  readonly season: number;
  readonly week: number;
  readonly team: string;
  readonly metric: string;
  readonly value: number;
  readonly asOf: Date;
}

async function storeCoachFacts(rows: readonly CoachRow[]): Promise<void> {
  await recordTeamObservations(db, rows.map((row) => ({ ...row, source: SCHEDULE_SOURCE.schedule })));
}

async function insertPlayers(entries: readonly (readonly [string, string])[]): Promise<void> {
  await db.insert(nflPlayers).values(
    entries.map(([id, position]) => ({ id, pfrId: id, name: id, position, latestTeam: null, rookieSeason: 2015, lastSeason: 2026 })),
  );
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("rb_workload_cliff", () => {
  const spec = specFor("rb_workload_cliff");

  beforeEach(async () => {
    await insertPlayers([
      ["heavy", "RB"],
      ["light", "RB"],
    ]);
    await storeLines([
      line(N, 1, "heavy", { rushingYards: 1000, receivingYards: 200, receptions: 60 }, BEFORE_GATE),
      line(N, 1, "light", { rushingYards: 400, receivingYards: 100, receptions: 50 }, BEFORE_GATE),
    ]);
    await storeParticipation([
      { season: N, week: 1, playerId: "heavy", metric: PARTICIPATION_METRICS.carries, value: 250, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "light", metric: PARTICIPATION_METRICS.carries, value: 100, asOf: BEFORE_GATE },
    ]);
  });

  it("flags 300+ combined carries and receptions, and computes PPR points/game", async () => {
    const points = await spec.population(db, [N]);
    const heavy = points.find((p) => p.playerId === "heavy")!;
    const light = points.find((p) => p.playerId === "light")!;

    // heavy: 250 carries + 60 receptions = 310 touches.
    expect(heavy.condition).toBe(true);
    expect(heavy.pointsPerGame).toBe(180); // 1000*0.1 + 200*0.1 + 60*1
    expect(heavy.matchKey).toBe(180);

    // light: 100 carries + 50 receptions = 150 touches.
    expect(light.condition).toBe(false);
    expect(light.pointsPerGame).toBe(100); // 400*0.1 + 100*0.1 + 50*1
  });

  it("does not let a late season-N correction, nor any season-N+1 fact, flip the condition", async () => {
    // A "correction" that would push light over 300 touches, filed AFTER the gate.
    await storeParticipation([{ season: N, week: 1, playerId: "light", metric: PARTICIPATION_METRICS.carries, value: 500, asOf: AFTER_GATE }]);
    // A season-N+1 fact entirely — wrong season, must never be read as season-N history.
    await storeParticipation([{ season: N1, week: 1, playerId: "light", metric: PARTICIPATION_METRICS.carries, value: 500, asOf: BEFORE_GATE }]);

    const points = await spec.population(db, [N]);
    const light = points.find((p) => p.playerId === "light")!;
    expect(light.condition).toBe(false);
  });
});

describe("rb_age_curve", () => {
  const spec = specFor("rb_age_curve");

  beforeEach(async () => {
    await insertPlayers([
      ["veteran", "RB"],
      ["young", "RB"],
    ]);
    await storeLines([
      line(N, 1, "veteran", { rushingYards: 100, receptions: 5 }, BEFORE_GATE),
      line(N, 1, "young", { rushingYards: 100, receptions: 5 }, BEFORE_GATE),
    ]);
    const cutdown = new Date("2023-08-25T00:00:00.000Z");
    await recordPreseasonRosters(db, [
      { season: N, team: "KC", playerId: "veteran", position: "RB", status: "active", birthDate: "1994-08-01", draftYear: 2016, draftPick: 50, draftClub: "KC", asOf: cutdown },
      { season: N, team: "BUF", playerId: "young", position: "RB", status: "active", birthDate: "2000-06-01", draftYear: 2022, draftPick: 80, draftClub: "BUF", asOf: cutdown },
    ]);
  });

  it("flags 28+ at the season opener", async () => {
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "veteran")!.condition).toBe(true);
    expect(points.find((p) => p.playerId === "young")!.condition).toBe(false);
  });

  it("ignores a birth-date row filed after the gate", async () => {
    // A bogus correction claiming young is actually old, filed after the gate — must be invisible.
    await recordPreseasonRosters(db, [
      { season: N, team: "BUF", playerId: "young", position: "RB", status: "active", birthDate: "1990-01-01", draftYear: 2022, draftPick: 80, draftClub: "BUF", asOf: AFTER_GATE },
    ]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "young")!.condition).toBe(false);
  });
});

describe("wr_target_competition", () => {
  const spec = specFor("wr_target_competition");

  beforeEach(async () => {
    await insertPlayers([
      ["wr1", "WR"],
      ["wr2", "WR"],
      ["te1", "TE"],
    ]);
    await recordPlayerTeams(db, [
      { season: N, week: 1, playerId: "wr1", team: "KC", asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wr2", team: "KC", asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "te1", team: "KC", asOf: BEFORE_GATE },
    ]);
    await storeParticipation([
      { season: N, week: 1, playerId: "wr1", metric: PARTICIPATION_METRICS.targets, value: 100, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wr2", metric: PARTICIPATION_METRICS.targets, value: 20, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "te1", metric: PARTICIPATION_METRICS.targets, value: 10, asOf: BEFORE_GATE },
    ]);
    await storeLines([
      line(N, 1, "wr1", { receivingYards: 800, receptions: 100 }, BEFORE_GATE),
      line(N, 1, "wr2", { receivingYards: 200, receptions: 20 }, BEFORE_GATE),
    ]);
  });

  it("flags the incumbent whose teammates claim more than 60% of the team's WR/TE targets", async () => {
    // Team WR/TE targets: 100 + 20 + 10 = 130. wr1's teammates hold 30/130 (23%); wr2's hold 110/130 (85%).
    const points = await spec.population(db, [N]);
    const wr1 = points.find((p) => p.playerId === "wr1")!;
    const wr2 = points.find((p) => p.playerId === "wr2")!;
    expect(wr1.condition).toBe(false);
    expect(wr1.pointsPerGame).toBe(180); // 800*0.1 + 100*1
    expect(wr2.condition).toBe(true);
    expect(wr2.pointsPerGame).toBe(40); // 200*0.1 + 20*1
    // TE is not part of the WR population itself.
    expect(points.some((p) => p.playerId === "te1")).toBe(false);
  });

  it("does not let a late-filed target correction flip the condition", async () => {
    // A correction that would make wr2 the dominant target claimer, filed after the gate.
    await storeParticipation([{ season: N, week: 1, playerId: "wr2", metric: PARTICIPATION_METRICS.targets, value: 200, asOf: AFTER_GATE }]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "wr2")!.condition).toBe(true);
  });
});

describe("play_caller_fingerprint", () => {
  const spec = specFor("play_caller_fingerprint");

  beforeEach(async () => {
    await insertPlayers([
      ["wrKC", "WR"],
      ["teKC", "TE"],
      ["wrBUF", "WR"],
      ["wrNYJ", "WR"],
    ]);
    await recordPlayerTeams(db, [
      { season: N, week: 1, playerId: "wrKC", team: "KC", asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "teKC", team: "KC", asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wrBUF", team: "BUF", asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wrNYJ", team: "NYJ", asOf: BEFORE_GATE },
    ]);
    await storeLines([
      line(N, 1, "wrKC", { receivingYards: 100, receptions: 10 }, BEFORE_GATE),
      line(N, 1, "teKC", { receivingYards: 80, receptions: 8 }, BEFORE_GATE),
      line(N, 1, "wrBUF", { receivingYards: 100, receptions: 10 }, BEFORE_GATE),
      line(N, 1, "wrNYJ", { receivingYards: 100, receptions: 10 }, BEFORE_GATE),
    ]);
    await storeCoachFacts([
      { season: N1, week: 1, team: "KC", metric: COACH_METRICS.tenureSeasons, value: 0, asOf: GATE },
      { season: N1, week: 1, team: "KC", metric: COACH_METRICS.priorPassRateOverExpected, value: 0.05, asOf: GATE },
      { season: N1, week: 1, team: "BUF", metric: COACH_METRICS.tenureSeasons, value: 3, asOf: GATE },
      { season: N1, week: 1, team: "NYJ", metric: COACH_METRICS.tenureSeasons, value: 0, asOf: GATE },
      { season: N1, week: 1, team: "NYJ", metric: COACH_METRICS.priorPassRateOverExpected, value: -0.02, asOf: GATE },
    ]);
  });

  it("flags WR/TE on a team with a first-year coach whose own history skews pass-heavy", async () => {
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "wrKC")!.condition).toBe(true);
    expect(points.find((p) => p.playerId === "teKC")!.condition).toBe(true);
    expect(points.find((p) => p.playerId === "wrBUF")!.condition).toBe(false); // tenure 3, not new
    expect(points.find((p) => p.playerId === "wrNYJ")!.condition).toBe(false); // new, but PROE negative
  });

  it("does not let a coach fact stamped after the gate flip the condition", async () => {
    await storeCoachFacts([
      { season: N1, week: 1, team: "BUF", metric: COACH_METRICS.tenureSeasons, value: 0, asOf: AFTER_GATE },
      { season: N1, week: 1, team: "BUF", metric: COACH_METRICS.priorPassRateOverExpected, value: 0.9, asOf: AFTER_GATE },
    ]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "wrBUF")!.condition).toBe(false);
  });
});

describe("target_share_persistence", () => {
  const spec = specFor("target_share_persistence");

  beforeEach(async () => {
    await insertPlayers([
      ["wrHigh", "WR"],
      ["wrLow", "WR"],
    ]);
    await storeLines([
      line(N, 1, "wrHigh", { receivingYards: 400, receptions: 40 }, BEFORE_GATE),
      line(N, 1, "wrLow", { receivingYards: 200, receptions: 20 }, BEFORE_GATE),
    ]);
    await storeParticipation([
      { season: N, week: 1, playerId: "wrHigh", metric: PARTICIPATION_METRICS.targets, value: 40, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wrHigh", metric: PARTICIPATION_METRICS.teamTargets, value: 150, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wrLow", metric: PARTICIPATION_METRICS.targets, value: 20, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wrLow", metric: PARTICIPATION_METRICS.teamTargets, value: 150, asOf: BEFORE_GATE },
    ]);
  });

  it("flags a season-N target share of 24% or more", async () => {
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "wrHigh")!.condition).toBe(true); // 40/150 = 26.7%
    expect(points.find((p) => p.playerId === "wrLow")!.condition).toBe(false); // 20/150 = 13.3%
  });

  it("does not let a late-filed target correction flip the condition", async () => {
    await storeParticipation([{ season: N, week: 1, playerId: "wrLow", metric: PARTICIPATION_METRICS.targets, value: 50, asOf: AFTER_GATE }]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "wrLow")!.condition).toBe(false);
  });
});

describe("td_regression", () => {
  const spec = specFor("td_regression");

  beforeEach(async () => {
    await insertPlayers([
      ["rbA", "RB"],
      ["rbB", "RB"],
      ["rbC", "RB"],
    ]);
    await storeLines([
      // Shares: 6/60=0.10, 12/80=0.15, 36/72=0.50 — median 0.15, threshold 1.5*0.15=0.225.
      line(N, 1, "rbA", { rushingYards: 540, rushingTouchdowns: 1 }, BEFORE_GATE),
      line(N, 1, "rbB", { rushingYards: 680, rushingTouchdowns: 2 }, BEFORE_GATE),
      line(N, 1, "rbC", { rushingYards: 360, rushingTouchdowns: 6 }, BEFORE_GATE),
    ]);
  });

  it("flags a touchdown-points share at least 1.5x the position-season median", async () => {
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "rbA")!.condition).toBe(false);
    expect(points.find((p) => p.playerId === "rbB")!.condition).toBe(false);
    expect(points.find((p) => p.playerId === "rbC")!.condition).toBe(true);
  });

  it("does not let a season-N+1 touchdown fact flip the season-N condition", async () => {
    await storeLines([line(N1, 1, "rbA", { rushingYards: 100, rushingTouchdowns: 10 }, BEFORE_GATE)]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "rbA")!.condition).toBe(false);
  });
});
