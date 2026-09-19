import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { jobRuns, jobs } from "@/db/schema";
import { createTestDb, truncateAll, truncateJobTables } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { JOBS_CONFIG } from "./config";
import {
  claimJobById,
  claimNextJob,
  completedStepsFor,
  enqueueJob,
  isJobPending,
  recordAttemptFailure,
  recordHeartbeat,
  recordStepCompletion,
  reclaimStaleJobs,
  retirePendingJobs,
  succeedJob,
} from "./store";

const db = createTestDb();

const T0 = "2026-09-08T12:00:00.000Z";
const clockAt = (iso: string): Clock => ({ now: () => iso });
const clock = clockAt(T0);

const request = (key: string, overrides: Partial<Parameters<typeof enqueueJob>[2]> = {}) => ({
  name: "season-week",
  idempotencyKey: key,
  payload: {},
  maxAttempts: 3,
  runAt: new Date(T0),
  ...overrides,
});

beforeEach(async () => {
  await truncateAll(db);
  await truncateJobTables(db);
});

describe("enqueueJob", () => {
  it("enqueues once per idempotency key, however many times it is asked", async () => {
    const first = await enqueueJob(db, clock, request("a"));
    const second = await enqueueJob(db, clock, request("a"));
    expect(first.enqueued).toBe(true);
    expect(second).toEqual({ enqueued: false, jobId: null });
    expect(await db.select().from(jobs)).toHaveLength(1);
  });
});

describe("claimNextJob", () => {
  it("claims in run_at order, opens the run row, and counts the attempt", async () => {
    await enqueueJob(db, clock, request("later", { runAt: new Date("2026-09-08T11:30:00Z") }));
    await enqueueJob(db, clock, request("earlier", { runAt: new Date("2026-09-08T11:00:00Z") }));

    const claimed = await claimNextJob(db, clock, "worker-1");
    expect(claimed).not.toBeNull();
    expect(claimed!.attempt).toBe(1);

    const jobRow = (await db.select().from(jobs).where(eq(jobs.id, claimed!.jobId)))[0]!;
    expect(jobRow.idempotencyKey).toBe("earlier");
    expect(jobRow.status).toBe("running");
    expect(jobRow.claimedBy).toBe("worker-1");
    expect(jobRow.attempts).toBe(1);

    const runRow = (await db.select().from(jobRuns).where(eq(jobRuns.id, claimed!.runId)))[0]!;
    expect(runRow.status).toBe("running");
    expect(runRow.attempt).toBe(1);
  });

  it("ignores jobs not yet due", async () => {
    await enqueueJob(db, clock, request("future", { runAt: new Date("2026-09-08T12:01:00Z") }));
    expect(await claimNextJob(db, clock, "worker-1")).toBeNull();
  });

  it("never hands one job to two contending workers", async () => {
    await enqueueJob(db, clock, request("one"));
    await enqueueJob(db, clock, request("two"));

    // Three concurrent claims race over two due jobs on one pool: SKIP LOCKED must hand out the
    // two jobs exactly once each and turn the loser away with null, never a duplicate.
    const claims = await Promise.all([
      claimNextJob(db, clock, "worker-a"),
      claimNextJob(db, clock, "worker-b"),
      claimNextJob(db, clock, "worker-c"),
    ]);
    const won = claims.filter((claim) => claim !== null);
    expect(won).toHaveLength(2);
    expect(new Set(won.map((claim) => claim.jobId)).size).toBe(2);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
  });
});

describe("claimJobById and retirePendingJobs (the self-wake's claim, draft-room performance round item 3)", () => {
  it("claims exactly the named job when pending and due, opening its run row; not when early, claimed or gone", async () => {
    const { jobId } = await enqueueJob(db, clock, request("by-id", { runAt: new Date(Date.parse(T0) + 500) }));
    expect(await claimJobById(db, clock, "w1", jobId!)).toBeNull();
    const later = clockAt(new Date(Date.parse(T0) + 500).toISOString());
    const claimed = await claimJobById(db, later, "w1", jobId!);
    expect(claimed).toMatchObject({ jobId, name: "season-week", attempt: 1 });
    expect(await claimJobById(db, later, "w2", jobId!)).toBeNull();
    expect(await claimJobById(db, later, "w2", jobId! + 999)).toBeNull();
    expect(await db.select().from(jobRuns).where(eq(jobRuns.jobId, jobId!))).toHaveLength(1);
  });

  it("retires only pending jobs, as succeeded with no run, and reports how many", async () => {
    const a = (await enqueueJob(db, clock, request("retire-a"))).jobId!;
    const b = (await enqueueJob(db, clock, request("retire-b"))).jobId!;
    await claimJobById(db, clock, "w1", b);
    expect(await retirePendingJobs(db, clock, [a, b])).toBe(1);
    expect(await retirePendingJobs(db, clock, [])).toBe(0);
    const rows = await db.select({ id: jobs.id, status: jobs.status }).from(jobs);
    expect(rows.find((row) => row.id === a)?.status).toBe("succeeded");
    expect(rows.find((row) => row.id === b)?.status).toBe("running");
    expect(await isJobPending(db, a)).toBe(false);
    expect(await isJobPending(db, a + 999)).toBe(false);
  });
});

describe("finishing an attempt", () => {
  it("succeedJob closes run and job together", async () => {
    await enqueueJob(db, clock, request("a"));
    const claimed = (await claimNextJob(db, clock, "worker-1"))!;
    await succeedJob(db, clockAt("2026-09-08T12:05:00.000Z"), claimed);

    const jobRow = (await db.select().from(jobs).where(eq(jobs.id, claimed.jobId)))[0]!;
    expect(jobRow.status).toBe("succeeded");
    expect(jobRow.claimedBy).toBeNull();
    expect(jobRow.finishedAt?.toISOString()).toBe("2026-09-08T12:05:00.000Z");
    const runRow = (await db.select().from(jobRuns).where(eq(jobRuns.id, claimed.runId)))[0]!;
    expect(runRow.status).toBe("succeeded");
  });

  it("a retry disposition requeues with the backoff instant", async () => {
    await enqueueJob(db, clock, request("a"));
    const claimed = (await claimNextJob(db, clock, "worker-1"))!;
    const retryAt = new Date("2026-09-08T12:02:00Z");
    await recordAttemptFailure(db, clock, claimed, {
      error: "nflverse: upstream 503",
      errorKind: "retryable",
      disposition: { kind: "retry", runAt: retryAt },
    });

    const jobRow = (await db.select().from(jobs).where(eq(jobs.id, claimed.jobId)))[0]!;
    expect(jobRow.status).toBe("pending");
    expect(jobRow.runAt.toISOString()).toBe(retryAt.toISOString());
    expect(jobRow.lastError).toBe("nflverse: upstream 503");

    // Not claimable before the backoff elapses; claimable after.
    expect(await claimNextJob(db, clockAt("2026-09-08T12:01:00.000Z"), "worker-2")).toBeNull();
    const reclaimed = await claimNextJob(db, clockAt("2026-09-08T12:02:00.000Z"), "worker-2");
    expect(reclaimed?.jobId).toBe(claimed.jobId);
    expect(reclaimed?.attempt).toBe(2);
  });

  it("a dead-letter disposition fails the job terminally and loudly in the row", async () => {
    await enqueueJob(db, clock, request("a"));
    const claimed = (await claimNextJob(db, clock, "worker-1"))!;
    await recordAttemptFailure(db, clock, claimed, {
      error: "freeze refused: week 1 kickoff has passed",
      errorKind: "terminal",
      disposition: { kind: "dead-letter" },
    });

    const jobRow = (await db.select().from(jobs).where(eq(jobs.id, claimed.jobId)))[0]!;
    expect(jobRow.status).toBe("failed");
    expect(jobRow.lastError).toContain("kickoff has passed");
    expect(await claimNextJob(db, clock, "worker-2")).toBeNull();
  });
});

describe("reclaimStaleJobs", () => {
  const later = (ms: number): Clock => clockAt(new Date(new Date(T0).getTime() + ms).toISOString());

  it("leaves a freshly heartbeating job alone", async () => {
    await enqueueJob(db, clock, request("a"));
    const claimed = (await claimNextJob(db, clock, "worker-1"))!;
    await recordHeartbeat(db, later(JOBS_CONFIG.staleAfterMs), claimed.jobId);

    const outcomes = await reclaimStaleJobs(db, later(JOBS_CONFIG.staleAfterMs + 1_000));
    expect(outcomes).toEqual([]);
  });

  it("requeues a crashed attempt with budget left, closing its run as abandoned", async () => {
    await enqueueJob(db, clock, request("a"));
    const claimed = (await claimNextJob(db, clock, "worker-1"))!;

    const outcomes = await reclaimStaleJobs(db, later(JOBS_CONFIG.staleAfterMs + 60_000));
    expect(outcomes).toEqual([{ jobId: claimed.jobId, name: "season-week", attempt: 1, disposition: "requeued" }]);

    const runRow = (await db.select().from(jobRuns).where(eq(jobRuns.id, claimed.runId)))[0]!;
    expect(runRow.status).toBe("abandoned");
    expect(runRow.errorKind).toBe("crash");
    const jobRow = (await db.select().from(jobs).where(eq(jobs.id, claimed.jobId)))[0]!;
    expect(jobRow.status).toBe("pending");
  });

  it("dead-letters as abandoned when the crashed attempt was the last", async () => {
    await enqueueJob(db, clock, request("a", { maxAttempts: 1 }));
    const claimed = (await claimNextJob(db, clock, "worker-1"))!;

    const outcomes = await reclaimStaleJobs(db, later(JOBS_CONFIG.staleAfterMs + 60_000));
    expect(outcomes[0]!.disposition).toBe("abandoned");
    const jobRow = (await db.select().from(jobs).where(eq(jobs.id, claimed.jobId)))[0]!;
    expect(jobRow.status).toBe("abandoned");
    expect(jobRow.lastError).toContain("stopped heartbeating");
  });
});

describe("checkpoints", () => {
  it("records once per (job, step) and reads back the completed set", async () => {
    await enqueueJob(db, clock, request("a"));
    const claimed = (await claimNextJob(db, clock, "worker-1"))!;

    await recordStepCompletion(db, clock, claimed, "stats-ingest", { summary: "ingested 12" });
    await recordStepCompletion(db, clock, claimed, "stats-ingest", { summary: "late duplicate" }); // no-op
    await recordStepCompletion(db, clock, claimed, "grade", { summary: "graded 1 week" });

    expect(await completedStepsFor(db, claimed.jobId)).toEqual(new Set(["stats-ingest", "grade"]));
  });
});
