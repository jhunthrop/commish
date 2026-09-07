import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs, players, preseasonProjections, users } from "@/db/schema";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll, truncateJobTables } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { PPR_SCORING, STANDARD_SCORING } from "@/domain/scoring";
import { createLeague } from "@/league-service/creation";
import { scoringHashOf } from "@/scoring";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "@/projections/nflverse/schedule";
import type { BoardEntry } from "@/projections/preseason/board";
import { BOARD_SOURCE, projectionRows, recordPreseasonProjections } from "@/projections/preseason/board-store";
import { recordTeamObservations } from "@/projections/team-store";
import { recordNflPlayers } from "@/projections/universe";
import { TerminalJobError } from "../contract";
import { executeClaimedJob, type ExecutorDeps } from "../execute";
import { RegisterRefusalError } from "../season-week/steps";
import { claimNextJob, completedStepsFor, enqueueJob } from "../store";
import { classifyFreezeError, parseSeasonWeekPayload, seasonWeekJobWith, SEASON_WEEK_JOB_NAME } from "./season-week-job";
import { PEEK_DOCUMENT_JOB_NAME } from "./peek-document-job";
import { defaultSeason } from "../season-week/steps";

const db = createTestDb();

const T0 = "2026-09-08T12:00:00.000Z";
const clock: Clock = { now: () => T0 };
const deps: ExecutorDeps = { db, clock, random: () => 0.5, workerId: "season-test" };

/** Canned network: the honest empty-preseason shapes — nflverse has published nothing, the
 *  books posted two events. No socket anywhere. */
const cannedNetwork = {
  ingestStats: async () => ({ observationsWritten: 0, statLines: 0, participationRows: 0, playerWeekUnavailable: true }),
  snapshotProps: async () => ({
    totalEvents: 2,
    selectedEvents: 2,
    totalWritten: 40,
    totalSkipped: 1,
    creditsRemaining: "480",
    creditsUsed: "20",
  }),
};

async function enqueueAndClaim() {
  await enqueueJob(db, clock, {
    name: SEASON_WEEK_JOB_NAME,
    idempotencyKey: "season-week-test",
    payload: {},
    maxAttempts: 3,
    runAt: new Date(T0),
  });
  return (await claimNextJob(db, clock, "season-test"))!;
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateJobTables(db);
});

describe("the season-week job", () => {
  it("runs the seven cadence steps against an empty season and succeeds with seven checkpoints", async () => {
    const definition = seasonWeekJobWith(cannedNetwork);
    const claimed = await enqueueAndClaim();

    const report = await executeClaimedJob(deps, new Map([[definition.name, definition]]), claimed);

    expect(report.outcome).toBe("succeeded");
    // Grade and freeze SKIP on an empty store (nothing gradable, no ingested kickoff) — the
    // honest preseason outcome, exactly as the crontab cadence reported it. `peek-facts` (the
    // peek-facts round, 2026-09-07) writes nothing when the board is empty, which is the same
    // honest zero its own summary reports, and `peek-documents` (the peek document round, the
    // same day) enqueues one rebuild per scoring hash in use, which on an empty store is none.
    expect(await completedStepsFor(db, claimed.jobId)).toEqual(
      new Set(["stats-ingest", "props-snapshot", "grade", "freeze", "scoreboard", "peek-facts", "peek-documents"]),
    );
  });

  /**
   * THE FINALIZE ROW OF THE PEEK DOCUMENT DESIGN'S EVENT TABLE (§3.4, row one), asserted by SCOPE
   * rather than only by the step having run.
   *
   * It rebuilds EVERY player (`playerIds: null`) for EVERY scoring hash a league is currently using,
   * which is the one event that deliberately does not narrow: a finalized week adds a column to every
   * chart and moves the percentile population every week and every points-per-game is judged
   * against, for the whole position. See the step's own docblock.
   */
  it("enqueues one whole-player rebuild per scoring hash in use, naming the finalized season", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "Manager 1" });
    const ppr = await createLeague({ db, clock, newId: () => "league_ppr" }, {
      name: "Sunday Money", format: "snake", teamCount: 12, scoringPreset: "ppr", auctionBudget: null,
      rosterSlots: STANDARD_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
      experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
    });
    const standard = await createLeague({ db, clock, newId: () => "league_standard" }, {
      name: "Old School", format: "snake", teamCount: 12, scoringPreset: "standard", auctionBudget: null,
      rosterSlots: STANDARD_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team Two" },
      experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
    });
    if (!ppr.ok || !standard.ok) throw new Error("league creation failed");
    await db.insert(players).values({ id: "rb1", name: "Volume Back", position: "RB", nflTeam: "SF", adp: 11 });

    const definition = seasonWeekJobWith(cannedNetwork);
    const claimed = await enqueueAndClaim();
    const report = await executeClaimedJob(deps, new Map([[definition.name, definition]]), claimed);
    expect(report.outcome).toBe("succeeded");

    const enqueued = await db.select().from(jobs).where(eq(jobs.name, PEEK_DOCUMENT_JOB_NAME));
    expect(enqueued).toHaveLength(2);
    expect(new Set(enqueued.map((job) => String((job.payload as { readonly scoringHash: string }).scoringHash)))).toEqual(
      new Set([scoringHashOf(PPR_SCORING), scoringHashOf(STANDARD_SCORING)]),
    );
    for (const job of enqueued) {
      expect(job.payload).toMatchObject({ playerIds: null, reason: `finalize:${defaultSeason(new Date(T0))}:${T0}` });
    }
  });

  it("enqueues no rebuild when no league carries a scoring hash yet", async () => {
    const definition = seasonWeekJobWith(cannedNetwork);
    const claimed = await enqueueAndClaim();
    await executeClaimedJob(deps, new Map([[definition.name, definition]]), claimed);

    expect(await db.select().from(jobs).where(eq(jobs.name, PEEK_DOCUMENT_JOB_NAME))).toEqual([]);
  });

  it("records a props-snapshot failure without failing the job, and freeze still runs", async () => {
    const definition = seasonWeekJobWith({
      ...cannedNetwork,
      snapshotProps: async () => {
        throw new Error("ODDS_API_KEY is not set");
      },
    });
    const claimed = await enqueueAndClaim();

    const report = await executeClaimedJob(deps, new Map([[definition.name, definition]]), claimed);

    expect(report.outcome).toBe("succeeded");
    const completed = await completedStepsFor(db, claimed.jobId);
    expect(completed.has("props-snapshot")).toBe(true);
    expect(completed.has("freeze")).toBe(true);
  });

  it("retries a transient stats-ingest failure rather than dead-lettering", async () => {
    const definition = seasonWeekJobWith({
      ...cannedNetwork,
      ingestStats: async () => {
        throw new Error("nflverse: upstream 503");
      },
    });
    const claimed = await enqueueAndClaim();

    const report = await executeClaimedJob(deps, new Map([[definition.name, definition]]), claimed);

    expect(report.outcome).toBe("retry-scheduled");
    expect(report.errorKind).toBe("retryable");
  });
});

describe("classifyFreezeError", () => {
  it.each(["past_kickoff", "empty_served_board", "no_served_role", "no_kickoff", "stitched_generations"] as const)(
    "marks the register's own %s refusal terminal, by type, and names the code",
    (code) => {
      const classified = classifyFreezeError(new RegisterRefusalError(code, "the register said no"));
      expect(classified).toBeInstanceOf(TerminalJobError);
      expect(classified.message).toContain(`[${code}]`);
    },
  );

  it("leaves a transient error retryable, even one whose prose sounds like a refusal", () => {
    // The old classifier matched message text; this is the desync it invited, pinned as a
    // negative: a plain Error is weather no matter what its sentence happens to say.
    for (const message of ["connection terminated unexpectedly", "The week has already begun, so a freeze taken now would not be a prospective claim."]) {
      expect(classifyFreezeError(new Error(message))).not.toBeInstanceOf(TerminalJobError);
    }
  });
});

/**
 * THE TWO REFUSAL PATHS, DRIVEN END-TO-END through the definition's own freeze step (via
 * `runRemainingSteps` with everything before it checkpointed): the register refuses for real
 * against a seeded store, and what escapes the job step must be a `TerminalJobError`. Fixture
 * shapes mirror `../season-week/steps.test.ts`'s seeding, minus everything these two paths never
 * reach. No `src/projections/register` import anywhere here — the refusal crosses as a type
 * through the wall-exempt steps module, and the seeds go through team-store and board-store.
 */
describe("the freeze step refuses terminally, end-to-end", () => {
  const SEASON = 2026;
  const KICKOFF = new Date("2026-09-10T00:20:00.000Z");
  const COMPLETED_BEFORE_FREEZE: ReadonlySet<string> = new Set(["stats-ingest", "props-snapshot", "grade"]);

  function boardEntry(playerId: string, points: number, rank: number): BoardEntry {
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

  async function seedKickoff(): Promise<void> {
    await recordTeamObservations(db, [
      {
        season: SEASON,
        week: 1,
        team: "CIN",
        source: SCHEDULE_SOURCE.kickoff,
        metric: SCHEDULE_METRICS.kickoffInstant,
        value: KICKOFF.getTime(),
        asOf: KICKOFF,
      },
    ]);
  }

  async function runFreezeStep(stepClock: Clock, stepDb: Db = db): Promise<void> {
    const definition = seasonWeekJobWith(cannedNetwork);
    await definition.runRemainingSteps({ db: stepDb, clock: stepClock }, { season: SEASON }, COMPLETED_BEFORE_FREEZE, async () => {});
  }

  /**
   * A db whose ONE generation-check query fails like a dropped connection (fix round 2, HIGH-A).
   * `assertSingleGeneration` is the only freeze-path caller of `selectDistinctOn` over the
   * `as_of` column — kickoffs, benchmarks and the board read either use `select` or distinct on
   * other columns — so matching on that exact column poisons precisely the query the finding
   * names and nothing before it.
   */
  function poisonGenerationCheck(realDb: Db): Db {
    return new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop !== "selectDistinctOn") return Reflect.get(target, prop, receiver);
        return (...args: unknown[]) => {
          const columns = args[0] as readonly unknown[] | undefined;
          if (Array.isArray(columns) && columns[0] === preseasonProjections.asOf) {
            throw new Error("connection terminated unexpectedly");
          }
          return (target.selectDistinctOn as (...a: unknown[]) => unknown)(...args);
        };
      },
    }) as Db;
  }

  it("classifies a transient error DURING the generation check retryable, never stitched-terminal", async () => {
    await seedKickoff();
    // Healthy store, sick connection: the exact case the first fix got wrong by wrapping
    // everything assertSingleGeneration threw into a terminal refusal.
    const failure = await runFreezeStep({ now: () => "2026-09-08T12:00:00.000Z" }, poisonGenerationCheck(db)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(TerminalJobError);
    expect((failure as Error).message).toContain("connection terminated unexpectedly");
  });

  it("classifies past-kickoff terminal when kickoff passes between the pick and the freeze", async () => {
    await seedKickoff();
    // A stateful clock stages the real race: the step's own read (first call) still sees the
    // kickoff ahead, so it picks week 1; `takeFreeze`'s read (every later call) lands after
    // kickoff, and the register refuses. Payload carries the season, so no other clock read
    // precedes these two.
    const calls = { count: 0 };
    const racingClock: Clock = {
      now: () => (calls.count++ === 0 ? "2026-09-10T00:19:00.000Z" : "2026-09-10T00:21:00.000Z"),
    };

    const failure = await runFreezeStep(racingClock).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(TerminalJobError);
    expect((failure as TerminalJobError).message).toContain("[past_kickoff]");
  });

  it("classifies a stitched two-generation board terminal", async () => {
    await seedKickoff();
    await recordNflPlayers(db, [
      { id: "00-0036900", pfrId: null, espnId: null, name: "Ja'Marr Chase", position: "WR", latestTeam: "CIN", rookieSeason: 2020, lastSeason: 2026 },
    ]);
    // Two generations of the served board, both at or before the freeze instant — the exact
    // stitched state `assertSingleGeneration` exists to refuse.
    for (const asOf of ["2026-09-01T00:00:00.000Z", "2026-09-02T00:00:00.000Z"]) {
      await recordPreseasonProjections(
        db,
        projectionRows([boardEntry("00-0036900", 326.4, 1)], {
          season: SEASON,
          source: BOARD_SOURCE,
          asOf: new Date(asOf),
          momentKind: "live",
        }),
      );
    }

    const failure = await runFreezeStep({ now: () => "2026-09-08T12:00:00.000Z" }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(TerminalJobError);
    expect((failure as TerminalJobError).message).toContain("[stitched_generations]");
    expect((failure as TerminalJobError).message).toContain("distinct as_of generations");
  });
});

describe("parseSeasonWeekPayload", () => {
  it("accepts an empty payload and a season override", () => {
    expect(parseSeasonWeekPayload({})).toEqual({});
    expect(parseSeasonWeekPayload({ season: 2026 })).toEqual({ season: 2026 });
  });

  it.each([[2026.5], ["2026"], [1999]])("refuses %j", (season) => {
    expect(() => parseSeasonWeekPayload({ season: season as never })).toThrow("season must be an integer year");
  });
});
