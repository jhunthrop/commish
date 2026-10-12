import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { jobs } from "@/db/schema";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll, truncateJobTables } from "@/db/test-db";
import type { Clock } from "@research-ts/domain/timing";
import { rerunJob } from "./rerun";
import { claimNextJob, enqueueJob, recordAttemptFailure } from "./store";

const db = createTestDb();

const T0 = "2026-09-08T12:00:00.000Z";
const clock: Clock = { now: () => T0 };

beforeEach(async () => {
  await truncateAll(db);
  await truncateJobTables(db);
});

async function deadLetteredJobId(): Promise<number> {
  await enqueueJob(db, clock, {
    name: "season-week",
    idempotencyKey: "original",
    payload: { season: 2026 },
    maxAttempts: 1,
    runAt: new Date(T0),
  });
  const claimed = (await claimNextJob(db, clock, "worker"))!;
  await recordAttemptFailure(db, clock, claimed, {
    error: "freeze refused",
    errorKind: "terminal",
    disposition: { kind: "dead-letter" },
  });
  return claimed.jobId;
}

describe("rerunJob", () => {
  it("enqueues a fresh copy of a dead-lettered job, history untouched", async () => {
    const originalId = await deadLetteredJobId();
    const result = await rerunJob(db, clock, originalId);

    expect(result).toEqual({ ok: true, newJobId: expect.any(Number) as number });
    const original = (await db.select().from(jobs).where(eq(jobs.id, originalId)))[0]!;
    expect(original.status).toBe("failed"); // the record of what happened stays
    const fresh = (await db.select().from(jobs).where(eq(jobs.id, (result as { newJobId: number }).newJobId)))[0]!;
    expect(fresh.status).toBe("pending");
    expect(fresh.name).toBe("season-week");
    expect(fresh.payload).toEqual({ season: 2026 });
    expect(fresh.idempotencyKey).toContain(`rerun:${originalId}:`);
  });

  it("refuses a job that is still pending or running", async () => {
    await enqueueJob(db, clock, { name: "season-week", idempotencyKey: "queued", payload: {}, maxAttempts: 3, runAt: new Date(T0) });
    const pending = (await db.select().from(jobs))[0]!;
    expect(await rerunJob(db, clock, pending.id)).toEqual({ ok: false, reason: "still-active" });
  });

  it("names a same-instant duplicate re-run for what it is", async () => {
    const originalId = await deadLetteredJobId();
    const first = await rerunJob(db, clock, originalId);
    expect(first.ok).toBe(true);
    // Same frozen clock reading = same idempotency key: the double click, not "still active".
    expect(await rerunJob(db, clock, originalId)).toEqual({ ok: false, reason: "duplicate-request" });
  });

  it("reports a missing job as not-found", async () => {
    expect(await rerunJob(db, clock, 999_999)).toEqual({ ok: false, reason: "not-found" });
  });
});
