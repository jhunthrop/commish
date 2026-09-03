import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { jobRuns, jobRunSteps, jobs } from "@/db/schema";
import { createTestDb, expectRejectionMatching, truncateAll, truncateJobTables } from "@/db/test-db";

/**
 * THE APPEND-ONLY GUARANTEE, asserted against the real triggers (migration 0068, the 0019
 * audit-spine precedent) rather than promised in prose: a `job_runs` row may finish itself
 * exactly once, a finished row is immutable, and the checkpoint log never changes at all.
 */
const db = createTestDb();

const T0 = new Date("2026-09-08T12:00:00Z");

async function insertJob(): Promise<number> {
  const rows = await db
    .insert(jobs)
    .values({
      name: "season-week",
      idempotencyKey: `test-${Math.random()}`,
      payload: {},
      status: "running",
      attempts: 1,
      maxAttempts: 3,
      runAt: T0,
      createdAt: T0,
    })
    .returning({ id: jobs.id });
  return rows[0]!.id;
}

async function insertRun(jobId: number, status: "running" | "failed"): Promise<number> {
  const rows = await db
    .insert(jobRuns)
    .values({ jobId, attempt: 1, status, startedAt: T0, claimedBy: "test-worker" })
    .returning({ id: jobRuns.id });
  return rows[0]!.id;
}

describe("job_runs is append-only history", () => {
  beforeEach(async () => {
    await truncateAll(db);
    await truncateJobTables(db);
  });

  it("lets the current running attempt finish itself exactly once", async () => {
    const jobId = await insertJob();
    const runId = await insertRun(jobId, "running");

    await db.update(jobRuns).set({ status: "succeeded", finishedAt: T0 }).where(eq(jobRuns.id, runId));

    const after = await db.select().from(jobRuns).where(eq(jobRuns.id, runId));
    expect(after[0]!.status).toBe("succeeded");
  });

  it("refuses to rewrite a finished run", async () => {
    const jobId = await insertJob();
    const runId = await insertRun(jobId, "failed");

    await expectRejectionMatching(
      db.update(jobRuns).set({ status: "succeeded" }).where(eq(jobRuns.id, runId)),
      /finished run \(status failed\) may not be rewritten/,
    );
  });

  it("never permits DELETE, running or finished", async () => {
    const jobId = await insertJob();
    const runId = await insertRun(jobId, "running");

    await expectRejectionMatching(db.delete(jobRuns).where(eq(jobRuns.id, runId)), /DELETE is not permitted/);
  });
});

describe("job_run_steps is an append-only checkpoint log", () => {
  beforeEach(async () => {
    await truncateAll(db);
    await truncateJobTables(db);
  });

  it("refuses UPDATE and DELETE outright", async () => {
    const jobId = await insertJob();
    const runId = await insertRun(jobId, "running");
    const stepRows = await db
      .insert(jobRunSteps)
      .values({ jobId, runId, step: "stats-ingest", completedAt: T0 })
      .returning({ id: jobRunSteps.id });
    const stepId = stepRows[0]!.id;

    await expectRejectionMatching(
      db.update(jobRunSteps).set({ step: "renamed" }).where(eq(jobRunSteps.id, stepId)),
      /UPDATE is not permitted/,
    );
    await expectRejectionMatching(db.delete(jobRunSteps).where(eq(jobRunSteps.id, stepId)), /DELETE is not permitted/);
  });

  it("records a step once per job, across attempts", async () => {
    const jobId = await insertJob();
    const runId = await insertRun(jobId, "running");
    await db.insert(jobRunSteps).values({ jobId, runId, step: "stats-ingest", completedAt: T0 });

    await expectRejectionMatching(
      db.insert(jobRunSteps).values({ jobId, runId, step: "stats-ingest", completedAt: T0 }),
      /job_run_steps_job_step_idx/,
    );
  });
});
