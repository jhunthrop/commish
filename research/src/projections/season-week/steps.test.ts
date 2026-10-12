import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research/db/client";
import { createTestDb, truncateAll } from "@research/db/test-db";
import { registerGradeRows } from "@research/db/schema";
import type { Clock } from "@research/domain/timing";
import { recordNflPlayers } from "@research/projections/universe";
import type { NflPlayerRow } from "@research/projections/nflverse/players";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "@research/projections/nflverse/schedule";
import { recordTeamObservations } from "@research/projections/team-store";
import { recordObservations, type PlayerWeekObservation } from "@research/projections/store";
import { STAT_LINE_SOURCE, statMetricName } from "@research/projections/lines";
import { BOARD_SOURCE, projectionRows, recordPreseasonProjections } from "@research/projections/preseason/board-store";
import type { BoardEntry } from "@research/projections/preseason/board";
import { BENCHMARK_SOURCES } from "@research/projections/preseason/benchmarks";
import { recordPreseasonRankings } from "@research/projections/preseason/store";
import { takeFreeze } from "@research/projections/register/freeze";
import { latestFreezeFor } from "@research/projections/register/store";
import {
  defaultSeason,
  gradeStep,
  pickWeekToFreeze,
  runSeasonWeek,
  scoreboardStep,
  type PropsSnapshotOutcome,
  type SeasonWeekDeps,
  type SeasonWeekOptions,
  type StatsIngestOutcome,
} from "./steps";

/**
 * THE CADENCE'S OWN ORCHESTRATION, tested the way `freeze.test.ts` and `grade.test.ts` test their
 * halves: a real test database (`createTestDb`), never a mock of the register. The only things
 * faked here are the two places this cadence reaches an external HTTP API — `ingestStats` and
 * `snapshotProps` on `SeasonWeekDeps` — so no suite run here ever opens a socket.
 */

const db = createTestDb();

const SEASON = 2026;
const WEEK_1_KICKOFF = new Date("2026-09-10T00:20:00.000Z");
const WEEK_2_KICKOFF = new Date("2026-09-18T00:15:00.000Z");
const BOARD_AS_OF = new Date("2026-09-02T03:20:39.210Z");
const BEFORE_KICKOFF = "2026-09-08T12:00:00.000Z";
const AFTER_BOTH_KICKOFFS = "2026-09-20T00:00:00.000Z";
// Stat lines (`STATS_AS_OF`, below) are stamped after week 1's own kickoff, so grading them
// point-in-time needs a clock later still — after this instant, not merely after kickoff.
const AFTER_STATS_LANDED = "2026-09-16T12:00:00.000Z";

const CHASE = "00-0036900";
const LAMB = "00-0036322";
const HURTS = "00-0036389";

function clockAt(iso: string): Clock {
  return { now: () => iso };
}

function player(id: string, name: string, position: string): NflPlayerRow {
  return { id, pfrId: null, espnId: null, name, position, latestTeam: "CIN", rookieSeason: 2020, lastSeason: 2026 };
}

function entry(playerId: string, points: number, rank: number): BoardEntry {
  return {
    playerId,
    position: "WR",
    projectedPoints: points,
    valueOverReplacement: points - 100,
    positionRank: rank,
    replacementLevel: 100,
    rank,
    valueRank: rank,
    team: "CIN",
    expectedGames: 16.2,
    seasonLine: { playerId, week: 0 } as BoardEntry["seasonLine"],
    outlook: { floor: points - 40, median: points, ceiling: points + 40 },
    tier: 0,
    playersLeftInTier: 4,
    dropToNextTier: 18.3,
    reasons: [],
  };
}

const STATS_AS_OF = new Date("2026-09-15T12:00:00.000Z");

function statRows(week: number, playerId: string, fields: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  return Object.entries(fields).map(([field, value]) => ({
    season: SEASON,
    week,
    playerId,
    source: STAT_LINE_SOURCE,
    metric: statMetricName(field),
    value,
    asOf: STATS_AS_OF,
  }));
}

async function seedKickoffs(): Promise<void> {
  await recordTeamObservations(db, [
    {
      season: SEASON,
      week: 1,
      team: "CIN",
      source: SCHEDULE_SOURCE.kickoff,
      metric: SCHEDULE_METRICS.kickoffInstant,
      value: WEEK_1_KICKOFF.getTime(),
      asOf: WEEK_1_KICKOFF,
    },
    {
      season: SEASON,
      week: 2,
      team: "CIN",
      source: SCHEDULE_SOURCE.kickoff,
      metric: SCHEDULE_METRICS.kickoffInstant,
      value: WEEK_2_KICKOFF.getTime(),
      asOf: WEEK_2_KICKOFF,
    },
  ]);
}

async function seedBoardAndBenchmarks(): Promise<void> {
  await recordNflPlayers(db, [
    player(CHASE, "Ja'Marr Chase", "WR"),
    player(LAMB, "CeeDee Lamb", "WR"),
    player(HURTS, "Jalen Hurts", "QB"),
  ]);
  await recordPreseasonProjections(
    db,
    projectionRows([entry(CHASE, 326.4, 1), entry(LAMB, 301.2, 2), entry(HURTS, 288.0, 3)], {
      season: SEASON,
      source: BOARD_SOURCE,
      asOf: BOARD_AS_OF,
      momentKind: "live",
    }),
  );
  const asOf = new Date("2026-09-01T00:00:00.000Z");
  await recordPreseasonRankings(db, [
    { season: SEASON, source: BENCHMARK_SOURCES.adp, playerId: CHASE, rank: 1.4, asOf },
    { season: SEASON, source: BENCHMARK_SOURCES.ecr, playerId: CHASE, rank: 2, asOf },
  ]);
}

async function seedThroughFreeze(frozenAt: string): Promise<void> {
  await seedKickoffs();
  await seedBoardAndBenchmarks();
  await takeFreeze(db, { season: SEASON, week: 1 }, clockAt(frozenAt));
}

async function seedOutcomes(): Promise<void> {
  await recordObservations(db, [
    ...statRows(1, CHASE, { receptions: 8, receivingYards: 120, receivingTouchdowns: 1 }),
    ...statRows(1, LAMB, { receptions: 5, receivingYards: 50 }),
    ...statRows(1, HURTS, { passingYards: 300, passingTouchdowns: 2 }),
  ]);
}

const IDLE_STATS: StatsIngestOutcome = { observationsWritten: 0, statLines: 0, participationRows: 0, playerWeekUnavailable: true };
const IDLE_PROPS: PropsSnapshotOutcome = {
  totalEvents: 0,
  selectedEvents: 0,
  totalWritten: 0,
  totalSkipped: 0,
  creditsRemaining: "unknown",
  creditsUsed: "unknown",
};

function depsAt(now: string, overrides: Partial<SeasonWeekDeps> = {}): SeasonWeekDeps {
  return {
    db,
    clock: clockAt(now),
    ingestStats: async () => IDLE_STATS,
    snapshotProps: async () => IDLE_PROPS,
    ...overrides,
  };
}

function optionsAt(overrides: Partial<SeasonWeekOptions> = {}): SeasonWeekOptions {
  return { season: SEASON, dryRun: false, refreeze: false, ...overrides };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("pickWeekToFreeze", () => {
  it("picks the smallest week whose kickoff is still ahead of now", () => {
    const kickoffs = new Map([
      [1, new Date("2026-09-10T00:20:00.000Z")],
      [2, new Date("2026-09-18T00:15:00.000Z")],
    ]);
    expect(pickWeekToFreeze(kickoffs, new Date("2026-09-01T00:00:00.000Z"))).toEqual({ week: 1, kickoff: kickoffs.get(1) });
    expect(pickWeekToFreeze(kickoffs, new Date("2026-09-12T00:00:00.000Z"))).toEqual({ week: 2, kickoff: kickoffs.get(2) });
  });

  it("returns null once every ingested kickoff is in the past", () => {
    const kickoffs = new Map([[1, new Date("2026-09-10T00:20:00.000Z")]]);
    expect(pickWeekToFreeze(kickoffs, new Date("2026-09-11T00:00:00.000Z"))).toBeNull();
  });

  it("returns null for an empty kickoff map", () => {
    expect(pickWeekToFreeze(new Map(), new Date("2026-09-01T00:00:00.000Z"))).toBeNull();
  });
});

describe("defaultSeason", () => {
  it("uses the calendar year from March through December", () => {
    expect(defaultSeason(new Date("2026-09-02T00:00:00.000Z"))).toBe(2026);
    expect(defaultSeason(new Date("2026-03-01T00:00:00.000Z"))).toBe(2026);
    expect(defaultSeason(new Date("2026-12-31T00:00:00.000Z"))).toBe(2026);
  });

  it("attributes January and February to the previous autumn's season", () => {
    expect(defaultSeason(new Date("2027-01-15T00:00:00.000Z"))).toBe(2026);
    expect(defaultSeason(new Date("2027-02-28T00:00:00.000Z"))).toBe(2026);
  });
});

describe("runSeasonWeek — step order", () => {
  it("runs all five steps, in order, even on a bare database", async () => {
    const { steps, exitCode } = await runSeasonWeek(depsAt(BEFORE_KICKOFF), optionsAt());
    expect(steps.map((step) => step.step)).toEqual(["stats-ingest", "props-snapshot", "grade", "freeze", "scoreboard"]);
    expect(exitCode).toBe(0);
  });
});

describe("runSeasonWeek — skip reasons", () => {
  it("skips stats-ingest, naming the season, when nflverse has not published anything", async () => {
    const { steps } = await runSeasonWeek(depsAt(BEFORE_KICKOFF), optionsAt());
    const step = steps.find((s) => s.step === "stats-ingest")!;
    expect(step.status).toBe("skipped");
    expect(step.summary).toContain("has not published weekly stats for season 2026");
  });

  it("skips stats-ingest as already-up-to-date when the file exists but nothing is new", async () => {
    const upToDate: StatsIngestOutcome = { observationsWritten: 0, statLines: 246, participationRows: 512, playerWeekUnavailable: false };
    const { steps } = await runSeasonWeek(depsAt(BEFORE_KICKOFF, { ingestStats: async () => upToDate }), optionsAt());
    const step = steps.find((s) => s.step === "stats-ingest")!;
    expect(step.status).toBe("skipped");
    expect(step.summary).toContain("already up to date");
  });

  it("reports stats-ingest ok when new observations landed", async () => {
    const fresh: StatsIngestOutcome = { observationsWritten: 340, statLines: 246, participationRows: 512, playerWeekUnavailable: false };
    const { steps } = await runSeasonWeek(depsAt(BEFORE_KICKOFF, { ingestStats: async () => fresh }), optionsAt());
    const step = steps.find((s) => s.step === "stats-ingest")!;
    expect(step.status).toBe("ok");
    expect(step.summary).toContain("ingested 340 new observation(s)");
  });

  it("skips grade with 'no ungraded weeks' when nothing is frozen yet", async () => {
    const { steps } = await runSeasonWeek(depsAt(BEFORE_KICKOFF), optionsAt());
    const step = steps.find((s) => s.step === "grade")!;
    expect(step.status).toBe("skipped");
    expect(step.summary).toContain("no ungraded weeks");
    expect(step.summary).toContain("0 frozen week");
  });

  it("skips grade once the only frozen week is already graded, and does not re-append a grade row", async () => {
    await seedThroughFreeze(BEFORE_KICKOFF);
    await seedOutcomes();
    const first = await gradeStep(depsAt(AFTER_STATS_LANDED), optionsAt());
    expect(first.status).toBe("ok");
    const second = await gradeStep(depsAt(AFTER_STATS_LANDED), optionsAt());
    expect(second.status).toBe("skipped");
    expect(second.summary).toContain("all already graded");
  });

  it("skips freeze with the existing instant when the current week is already frozen", async () => {
    await seedThroughFreeze(BEFORE_KICKOFF);
    const { steps } = await runSeasonWeek(depsAt(BEFORE_KICKOFF), optionsAt());
    const step = steps.find((s) => s.step === "freeze")!;
    expect(step.status).toBe("skipped");
    expect(step.summary).toContain("already frozen at 2026-09-08T12:00:00.000Z");
    expect(step.summary).toContain("--refreeze");
  });

  it("skips freeze with 'no upcoming week' once every ingested kickoff has passed", async () => {
    await seedKickoffs();
    const { steps } = await runSeasonWeek(depsAt(AFTER_BOTH_KICKOFFS), optionsAt());
    const step = steps.find((s) => s.step === "freeze")!;
    expect(step.status).toBe("skipped");
    expect(step.summary).toContain("no upcoming week to freeze");
  });

  it("takes a real freeze for the current week when nothing is frozen yet and kickoff has not happened", async () => {
    await seedKickoffs();
    await seedBoardAndBenchmarks();
    const { steps } = await runSeasonWeek(depsAt(BEFORE_KICKOFF), optionsAt());
    const step = steps.find((s) => s.step === "freeze")!;
    expect(step.status).toBe("ok");
    expect(step.summary).toContain("froze week 1");
    expect(await latestFreezeFor(db, SEASON, 1)).not.toBeNull();
  });
});

/**
 * A drizzle SELECT that always rejects, whatever it is chained with next (`.where`, `.groupBy`,
 * `.orderBy`, `.limit` — every store function this file poisons uses some subset of these before
 * being awaited). Every chain method returns itself, so the shape is right no matter which
 * store function's own chain reaches it, and `await`ing it anywhere rejects with `message`.
 */
interface ThrowingQueryResult extends PromiseLike<never> {
  readonly where: () => ThrowingQueryResult;
  readonly groupBy: () => ThrowingQueryResult;
  readonly orderBy: () => ThrowingQueryResult;
  readonly limit: () => ThrowingQueryResult;
}

function throwingQueryResult(message: string): ThrowingQueryResult {
  const self: ThrowingQueryResult = {
    where: () => self,
    groupBy: () => self,
    orderBy: () => self,
    limit: () => self,
    // The rejected promise is created INSIDE `then`, not stored eagerly: every real caller awaits
    // this immediately (drizzle's own chains always are), so `.then` is attached synchronously and
    // nothing is ever left an unhandled rejection.
    then: (onfulfilled, onrejected) => Promise.reject(new Error(message)).then(onfulfilled, onrejected),
  };
  return self;
}

/**
 * Wraps a real `Db` so that reads of ONE table fail — everything else (every other table, and
 * every non-`select` method: `.transaction`, `.$client`, …) passes straight through to the real
 * connection. `allowedCalls` lets the first N reads of the poisoned table through before it starts
 * throwing, which is what isolates "only THIS step's read of the table fails" from "every step
 * that happens to read the same table also fails" — see `scoreboardStep` below, which shares
 * `registerGradeRows` with `gradeStep` and needs its OWN call poisoned without also breaking
 * grade's.
 *
 * This exists because `gradeStep` and `freezeStep` (unlike `statsIngestStep`/`propsSnapshotStep`)
 * have no injected network-shaped dependency to fail directly — they call the register straight
 * against `deps.db`, deliberately, the same way `freeze.test.ts`/`grade.test.ts` do. The only way
 * to make ONE of them throw for real, isolated from the others, is to make ITS OWN read of the
 * store fail while every other step's own reads (of other tables, or of the same table but not
 * yet exhausted their `allowedCalls`) keep working against the real test database.
 */
function poisonTableReads(realDb: Db, targetTable: unknown, message: string, allowedCalls = 0): Db {
  let callCount = 0;
  return new Proxy(realDb, {
    get(target, prop, receiver) {
      if (prop !== "select") return Reflect.get(target, prop, receiver);
      return (...selectArgs: unknown[]) => ({
        from: (table: unknown) => {
          if (table !== targetTable) return (target.select as (...args: unknown[]) => { from: (t: unknown) => unknown })(...selectArgs).from(table);
          callCount += 1;
          return callCount <= allowedCalls
            ? (target.select as (...args: unknown[]) => { from: (t: unknown) => unknown })(...selectArgs).from(table)
            : throwingQueryResult(message);
        },
      });
    },
  }) as Db;
}

/** Every step name, in the order `runSeasonWeek` runs them — used to assert the full five-entry
 *  shape survives any single step's failure, not merely that the failing step reports it. */
const ALL_STEP_NAMES = ["stats-ingest", "props-snapshot", "grade", "freeze", "scoreboard"] as const;

describe("runSeasonWeek — failure isolation", () => {
  it("marks stats-ingest failed without blocking the other four steps, which all still ran and succeeded", async () => {
    await seedThroughFreeze(BEFORE_KICKOFF);
    const failingStats: SeasonWeekDeps["ingestStats"] = async () => {
      throw new Error("nflverse returned HTTP 500");
    };
    const { steps, exitCode } = await runSeasonWeek(depsAt(BEFORE_KICKOFF, { ingestStats: failingStats }), optionsAt());
    expect(steps.map((step) => step.step)).toEqual(ALL_STEP_NAMES);
    expect(steps.find((s) => s.step === "stats-ingest")!.status).toBe("failed");
    expect(steps.find((s) => s.step === "stats-ingest")!.summary).toContain("nflverse returned HTTP 500");
    for (const name of ["props-snapshot", "grade", "freeze", "scoreboard"] as const) {
      expect(steps.find((s) => s.step === name)!.status, `${name} should not be failed`).not.toBe("failed");
    }
    expect(exitCode).toBe(1);
  });

  it("marks props-snapshot failed without blocking the other four steps, which all still ran and succeeded", async () => {
    await seedThroughFreeze(BEFORE_KICKOFF);
    const failingProps: SeasonWeekDeps["snapshotProps"] = async () => {
      throw new Error("ODDS_API_KEY is not set");
    };
    const { steps, exitCode } = await runSeasonWeek(depsAt(BEFORE_KICKOFF, { snapshotProps: failingProps }), optionsAt());
    expect(steps.map((step) => step.step)).toEqual(ALL_STEP_NAMES);
    expect(steps.find((s) => s.step === "props-snapshot")!.status).toBe("failed");
    expect(steps.find((s) => s.step === "props-snapshot")!.summary).toContain("ODDS_API_KEY is not set");
    for (const name of ["stats-ingest", "grade", "freeze", "scoreboard"] as const) {
      expect(steps.find((s) => s.step === name)!.status, `${name} should not be failed`).not.toBe("failed");
    }
    expect(exitCode).toBe(1);
  });

  it("marks grade failed (the brief's named case) without blocking stats-ingest, props-snapshot or freeze", async () => {
    // Freeze is seeded, but no outcomes — grade would ordinarily just SKIP, not fail. Poisoning
    // registerGradeRows makes gradeStep's own read throw for real, before it ever reaches that
    // per-week skip logic. freezeStep never touches registerGradeRows at all, so it is unaffected;
    // scoreboardStep DOES read the same table (it reports population from it) and is expected to
    // fail too — that is an honest consequence of sharing the table, not a broken isolation, and
    // is asserted separately below as "still ran", not as "succeeded".
    await seedThroughFreeze(BEFORE_KICKOFF);
    const poisonedDb = poisonTableReads(db, registerGradeRows, "register_grade_rows is unreachable", 0);
    const { steps, exitCode } = await runSeasonWeek(depsAt(BEFORE_KICKOFF, { db: poisonedDb }), optionsAt());
    expect(steps.map((step) => step.step)).toEqual(ALL_STEP_NAMES);
    const grade = steps.find((s) => s.step === "grade")!;
    expect(grade.status).toBe("failed");
    expect(grade.summary).toContain("register_grade_rows is unreachable");
    for (const name of ["stats-ingest", "props-snapshot", "freeze"] as const) {
      expect(steps.find((s) => s.step === name)!.status, `${name} should not be failed`).not.toBe("failed");
    }
    // scoreboard shares the poisoned table and is expected to fail too — asserted as "still ran"
    // (present, with its own reported status), not as having succeeded despite the same outage.
    expect(steps.find((s) => s.step === "scoreboard")).toBeDefined();
    expect(exitCode).toBe(1);
  });

  it("marks freeze failed (the brief's named case) without blocking stats-ingest, props-snapshot or grade", async () => {
    // A real, natural takeFreeze refusal (freeze.ts's own guard): kickoffs exist but the served
    // board does not, so takeFreeze throws "no rows" before writing anything. No table poisoning
    // needed here — freeze fails for its own business reason, and nothing else depends on the
    // board: grade has nothing frozen to grade (a clean skip, not a failure), stats-ingest and
    // props-snapshot use their own injected outcomes, and scoreboard is a read with nothing to see.
    await seedKickoffs();
    const { steps, exitCode } = await runSeasonWeek(depsAt(BEFORE_KICKOFF), optionsAt());
    expect(steps.map((step) => step.step)).toEqual(ALL_STEP_NAMES);
    const freeze = steps.find((s) => s.step === "freeze")!;
    expect(freeze.status).toBe("failed");
    expect(freeze.summary).toMatch(/served board.*holds no.*rows/i);
    for (const name of ["stats-ingest", "props-snapshot", "grade", "scoreboard"] as const) {
      expect(steps.find((s) => s.step === name)!.status, `${name} should not be failed`).not.toBe("failed");
    }
    expect(exitCode).toBe(1);
  });

  it("marks scoreboard failed without blocking (or invalidating) stats-ingest, props-snapshot, grade or freeze", async () => {
    // grade is allowed exactly its own one real read of registerGradeRows (so it succeeds
    // normally); scoreboard's own two reads (runningScoreboard + perWeekPopulation) exceed the
    // allowance and fail — isolating scoreboard's failure from grade's success, not merely
    // asserting "something downstream also broke" the way the grade test above does.
    await seedThroughFreeze(BEFORE_KICKOFF);
    await seedOutcomes();
    const poisonedDb = poisonTableReads(db, registerGradeRows, "register_grade_rows is unreachable", 1);
    const { steps, exitCode } = await runSeasonWeek(depsAt(AFTER_STATS_LANDED, { db: poisonedDb }), optionsAt());
    expect(steps.map((step) => step.step)).toEqual(ALL_STEP_NAMES);
    const scoreboard = steps.find((s) => s.step === "scoreboard")!;
    expect(scoreboard.status).toBe("failed");
    expect(scoreboard.summary).toContain("register_grade_rows is unreachable");
    const grade = steps.find((s) => s.step === "grade")!;
    expect(grade.status, "grade should have succeeded on its own allowed read").toBe("ok");
    for (const name of ["stats-ingest", "props-snapshot", "freeze"] as const) {
      expect(steps.find((s) => s.step === name)!.status, `${name} should not be failed`).not.toBe("failed");
    }
    expect(exitCode).toBe(1);
  });

  it("returns exit code 0 when every step is ok or skipped", async () => {
    const { exitCode } = await runSeasonWeek(depsAt(BEFORE_KICKOFF), optionsAt());
    expect(exitCode).toBe(0);
  });
});

describe("runSeasonWeek — --dry-run", () => {
  it("never calls ingestStats or snapshotProps, and never takes a freeze", async () => {
    await seedKickoffs();
    await seedBoardAndBenchmarks();
    let statsCalled = false;
    let propsCalled = false;
    const deps = depsAt(BEFORE_KICKOFF, {
      ingestStats: async () => {
        statsCalled = true;
        return IDLE_STATS;
      },
      snapshotProps: async () => {
        propsCalled = true;
        return IDLE_PROPS;
      },
    });
    const { steps } = await runSeasonWeek(deps, optionsAt({ dryRun: true }));
    expect(statsCalled).toBe(false);
    expect(propsCalled).toBe(false);
    expect(steps.every((step) => step.status === "skipped" || step.step === "scoreboard")).toBe(true);
    for (const step of steps) expect(step.summary.startsWith("[dry-run]") || step.step === "scoreboard").toBe(true);
    expect(await latestFreezeFor(db, SEASON, 1)).toBeNull();
  });

  it("does not append a grade row for a dry-run pass", async () => {
    await seedThroughFreeze(BEFORE_KICKOFF);
    await seedOutcomes();
    const { steps } = await runSeasonWeek(depsAt(BEFORE_KICKOFF), optionsAt({ dryRun: true }));
    const grade = steps.find((s) => s.step === "grade")!;
    expect(grade.status).toBe("skipped");
    expect(grade.summary).toContain("[dry-run]");
    // A real grade attempt afterwards still finds the week ungraded — nothing was written.
    const real = await gradeStep(depsAt(AFTER_STATS_LANDED), optionsAt());
    expect(real.status).toBe("ok");
  });
});

describe("runSeasonWeek — --refreeze", () => {
  it("supersedes an existing freeze instead of skipping when --refreeze is passed", async () => {
    await seedThroughFreeze(BEFORE_KICKOFF);
    const laterClock = "2026-09-09T12:00:00.000Z";
    const { steps } = await runSeasonWeek(depsAt(laterClock), optionsAt({ refreeze: true }));
    const freeze = steps.find((s) => s.step === "freeze")!;
    expect(freeze.status).toBe("ok");
    expect(freeze.summary).toContain("superseded week 1");
    expect((await latestFreezeFor(db, SEASON, 1))?.toISOString()).toBe(new Date(laterClock).toISOString());
  });

  it("without --refreeze the same scenario just skips, citing the original instant", async () => {
    await seedThroughFreeze(BEFORE_KICKOFF);
    const laterClock = "2026-09-09T12:00:00.000Z";
    const { steps } = await runSeasonWeek(depsAt(laterClock), optionsAt({ refreeze: false }));
    const freeze = steps.find((s) => s.step === "freeze")!;
    expect(freeze.status).toBe("skipped");
    expect((await latestFreezeFor(db, SEASON, 1))?.toISOString()).toBe(new Date(BEFORE_KICKOFF).toISOString());
  });
});

describe("scoreboardStep", () => {
  it("prints per-week population from the latest grading of each week", async () => {
    await seedThroughFreeze(BEFORE_KICKOFF);
    await seedOutcomes();
    await gradeStep(depsAt(AFTER_STATS_LANDED), optionsAt());
    const result = await scoreboardStep(depsAt(AFTER_STATS_LANDED), optionsAt());
    expect(result.status).toBe("ok");
    expect(result.detail.some((line) => line.includes("week 1=3"))).toBe(true);
  });

  it("reports no graded weeks yet on a bare database", async () => {
    const result = await scoreboardStep(depsAt(BEFORE_KICKOFF), optionsAt());
    expect(result.detail.some((line) => line.includes("no graded weeks yet"))).toBe(true);
  });
});
