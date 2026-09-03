import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll, truncateJobTables } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { TerminalJobError } from "../contract";
import { executeClaimedJob, type ExecutorDeps } from "../execute";
import { claimNextJob, completedStepsFor, enqueueJob } from "../store";
import { classifyFreezeError, parseSeasonWeekPayload, seasonWeekJobWith, SEASON_WEEK_JOB_NAME } from "./season-week-job";

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
  it("runs the five cadence steps against an empty season and succeeds with five checkpoints", async () => {
    const definition = seasonWeekJobWith(cannedNetwork);
    const claimed = await enqueueAndClaim();

    const report = await executeClaimedJob(deps, new Map([[definition.name, definition]]), claimed);

    expect(report.outcome).toBe("succeeded");
    // Grade and freeze SKIP on an empty store (nothing gradable, no ingested kickoff) — the
    // honest preseason outcome, exactly as the crontab cadence reported it.
    expect(await completedStepsFor(db, claimed.jobId)).toEqual(
      new Set(["stats-ingest", "props-snapshot", "grade", "freeze", "scoreboard"]),
    );
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
  it.each([
    "2026 week 1's first kickoff (2026-09-11T00:20:00.000Z) is not after 2026-09-11T01:00:00.000Z. The week has already begun, so a freeze taken now would not be a prospective claim. Refusing.",
    'The served board ("preseason-v9") holds no 2026 rows at or before 2026-09-08T12:00:00.000Z, so there is no claim to freeze. Run `npm run projections:preseason:persist` first.',
    "register/sources.ts lists no board with the `served` role, so this freeze has no claim about the product to record.",
    "The store holds no ingested kickoff for 2026 week 1, so there is nothing to check a freeze against.",
  ])("marks the register's own refusals terminal: %s", (message) => {
    expect(classifyFreezeError(new Error(message))).toBeInstanceOf(TerminalJobError);
  });

  it("leaves a transient error retryable", () => {
    const classified = classifyFreezeError(new Error("connection terminated unexpectedly"));
    expect(classified).not.toBeInstanceOf(TerminalJobError);
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
