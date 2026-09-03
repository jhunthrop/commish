// THE QUEUE'S LIFECYCLE, and nothing else: enqueue, claim, heartbeat, finish, reclaim,
// checkpoints. Schedule cursors live with the scheduler (`schedule.ts`), admin reads with the
// admin surface (`admin-view.ts`) — this file is the one place a `jobs` row's status ever moves.
import { and, asc, eq, lt, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { unwrapCauseChain } from "@/db/errors";
import { jobRunSteps, jobRuns, jobs } from "@/db/schema";
import type { JsonObject } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import { JOBS_CONFIG } from "./config";

export interface EnqueueRequest {
  readonly name: string;
  /** What makes a double enqueue harmless — see the schema doc. Schedule fires use
   *  `<schedule>@<fireInstantISO>`; operator re-runs mint a fresh key deliberately. */
  readonly idempotencyKey: string;
  readonly payload: JsonObject;
  readonly maxAttempts: number;
  /** When the job becomes eligible. A schedule fire enqueues at its fire instant. */
  readonly runAt: Date;
  readonly scheduleName?: string;
  readonly scheduledFor?: Date;
}

export interface EnqueueResult {
  /** False when the idempotency key already existed — the harmless double tick. */
  readonly enqueued: boolean;
  readonly jobId: number | null;
}

export async function enqueueJob(db: Db, clock: Clock, request: EnqueueRequest): Promise<EnqueueResult> {
  const inserted = await db
    .insert(jobs)
    .values({
      name: request.name,
      idempotencyKey: request.idempotencyKey,
      payload: request.payload,
      status: "pending",
      attempts: 0,
      maxAttempts: request.maxAttempts,
      runAt: request.runAt,
      scheduleName: request.scheduleName,
      scheduledFor: request.scheduledFor,
      createdAt: new Date(clock.now()),
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning({ id: jobs.id });
  const row = inserted[0];
  return row === undefined ? { enqueued: false, jobId: null } : { enqueued: true, jobId: row.id };
}

export interface ClaimedJob {
  readonly jobId: number;
  readonly runId: number;
  readonly name: string;
  readonly payload: JsonObject;
  /** This attempt's 1-based number — already incremented onto the row by the claim itself, so a
   *  crash mid-run still consumed the attempt. */
  readonly attempt: number;
  readonly maxAttempts: number;
}

/**
 * THE CLAIM — `FOR UPDATE SKIP LOCKED` inside one transaction, so two workers can never hold the
 * same job: whoever locks the row first gets it, the other worker's scan skips the locked row
 * entirely rather than blocking on it. Claiming also opens the attempt's `job_runs` row, in the
 * same transaction, so history can never be missing its own beginning.
 */
export async function claimNextJob(db: Db, clock: Clock, workerId: string): Promise<ClaimedJob | null> {
  const now = new Date(clock.now());
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, now)))
      .orderBy(asc(jobs.runAt), asc(jobs.id))
      .limit(1)
      .for("update", { skipLocked: true });
    const row = candidates[0];
    if (row === undefined) return null;

    const attempt = row.attempts + 1;
    await tx
      .update(jobs)
      .set({ status: "running", claimedBy: workerId, heartbeatAt: now, attempts: attempt })
      .where(eq(jobs.id, row.id));
    const runRows = await tx
      .insert(jobRuns)
      .values({ jobId: row.id, attempt, status: "running", startedAt: now, claimedBy: workerId })
      .returning({ id: jobRuns.id });
    return { jobId: row.id, runId: runRows[0]!.id, name: row.name, payload: row.payload, attempt, maxAttempts: row.maxAttempts };
  });
}

/** Refreshed on an interval while an attempt runs — the liveness signal `reclaimStaleJobs` reads. */
export async function recordHeartbeat(db: Db, clock: Clock, jobId: number): Promise<void> {
  await db.update(jobs).set({ heartbeatAt: new Date(clock.now()) }).where(eq(jobs.id, jobId));
}

export async function succeedJob(db: Db, clock: Clock, claimed: ClaimedJob): Promise<void> {
  const now = new Date(clock.now());
  await db.transaction(async (tx) => {
    await tx.update(jobRuns).set({ status: "succeeded", finishedAt: now }).where(eq(jobRuns.id, claimed.runId));
    await tx
      .update(jobs)
      .set({ status: "succeeded", claimedBy: null, heartbeatAt: null, lastError: null, finishedAt: now })
      .where(eq(jobs.id, claimed.jobId));
  });
}

export type FailureDisposition =
  /** Retryable with budget left: back to `pending`, eligible again at `runAt`. */
  | { readonly kind: "retry"; readonly runAt: Date }
  /** Terminal (a `TerminalJobError`, or retryable errors exhausting `maxAttempts`): the job
   *  dead-letters as `failed`. Loud by construction — the admin page lists it first. */
  | { readonly kind: "dead-letter" };

export interface AttemptFailure {
  readonly error: string;
  readonly errorKind: "retryable" | "terminal" | "timeout" | "crash";
  readonly disposition: FailureDisposition;
}

export async function recordAttemptFailure(db: Db, clock: Clock, claimed: ClaimedJob, failure: AttemptFailure): Promise<void> {
  const now = new Date(clock.now());
  await db.transaction(async (tx) => {
    await tx
      .update(jobRuns)
      .set({ status: "failed", finishedAt: now, error: failure.error, errorKind: failure.errorKind })
      .where(eq(jobRuns.id, claimed.runId));
    if (failure.disposition.kind === "retry") {
      await tx
        .update(jobs)
        .set({ status: "pending", claimedBy: null, heartbeatAt: null, lastError: failure.error, runAt: failure.disposition.runAt })
        .where(eq(jobs.id, claimed.jobId));
    } else {
      await tx
        .update(jobs)
        .set({ status: "failed", claimedBy: null, heartbeatAt: null, lastError: failure.error, finishedAt: now })
        .where(eq(jobs.id, claimed.jobId));
    }
  });
}

/**
 * The SQLSTATE migration 0069's history-rewrite triggers raise — one custom code, matched by
 * `.code` alone (fix round 2, MEDIUM-B: the first fix matched the trigger's English, a sentence
 * edit away from silent desync). Exported so the migration and this predicate name one constant;
 * a future trigger edit that drops the code fails the staged-race tests, not production.
 */
export const JOB_HISTORY_REWRITE_SQLSTATE = "JB001";

/**
 * THE RECLAIM RACE'S SIGNATURE. A worker whose attempt was reclaimed mid-flight (a long GC
 * pause, a laptop lid) is a zombie the moment `reclaimStaleJobs` closes its run row as
 * `abandoned` — and when it later tries to finish, the append-only trigger rejects the rewrite
 * with SQLSTATE `JB001` and the whole finish transaction rolls back. That rejection is CORRECT
 * (a newer attempt owns the job now; the zombie's late result must not overwrite the record),
 * but it must not kill the caller's tick: the executor asks this predicate and reports the
 * attempt `superseded` instead of throwing. Matched via the same cause-chain walk
 * `expectRejectionMatching` uses, because drizzle wraps the driver's error one level down; the
 * message is not consulted.
 */
export function isSupersededAttempt(error: unknown): boolean {
  return unwrapCauseChain(error).some(
    (link) => (link as { readonly code?: unknown }).code === JOB_HISTORY_REWRITE_SQLSTATE,
  );
}

export interface ReclaimedJob {
  readonly jobId: number;
  readonly name: string;
  readonly attempt: number;
  readonly disposition: "requeued" | "abandoned";
}

/**
 * THE CRASH PATH. A process that died mid-attempt (laptop slept, Vercel function hit its wall)
 * left a `running` job whose heartbeat stopped. Any tick's reclaim pass finds those past
 * `JOBS_CONFIG.staleAfterMs`, closes the orphaned run row as `abandoned`, and either requeues the
 * job (attempts remaining — immediately: a crash says nothing about the work being bad, so it
 * earns no backoff) or dead-letters it as `abandoned`. `SKIP LOCKED` again, so two concurrent
 * ticks reclaim disjoint sets.
 */
export async function reclaimStaleJobs(db: Db, clock: Clock): Promise<readonly ReclaimedJob[]> {
  const now = new Date(clock.now());
  const cutoff = new Date(now.getTime() - JOBS_CONFIG.staleAfterMs);
  return db.transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "running"), lt(jobs.heartbeatAt, cutoff)))
      .orderBy(asc(jobs.id))
      .for("update", { skipLocked: true });

    const outcomes: ReclaimedJob[] = [];
    for (const row of stale) {
      const error = `worker "${row.claimedBy ?? "unknown"}" stopped heartbeating (last beat ${row.heartbeatAt?.toISOString() ?? "never"}); attempt ${row.attempts} reclaimed`;
      await tx
        .update(jobRuns)
        .set({ status: "abandoned", finishedAt: now, error, errorKind: "crash" })
        .where(and(eq(jobRuns.jobId, row.id), eq(jobRuns.attempt, row.attempts), eq(jobRuns.status, "running")));

      const exhausted = row.attempts >= row.maxAttempts;
      await tx
        .update(jobs)
        .set(
          exhausted
            ? { status: "abandoned", claimedBy: null, heartbeatAt: null, lastError: error, finishedAt: now }
            : { status: "pending", claimedBy: null, heartbeatAt: null, lastError: error, runAt: now },
        )
        .where(eq(jobs.id, row.id));
      outcomes.push({ jobId: row.id, name: row.name, attempt: row.attempts, disposition: exhausted ? "abandoned" : "requeued" });
    }
    return outcomes;
  });
}

/**
 * Appends a step's checkpoint. `onConflictDoNothing` on `(job_id, step)`: after a reclaim race,
 * two workers can briefly both believe they own an attempt, and the loser's late checkpoint must
 * be a no-op rather than an error — the step IS complete either way, which is all resume reads.
 */
export async function recordStepCompletion(
  db: Db,
  clock: Clock,
  claimed: ClaimedJob,
  step: string,
  detail: JsonObject,
): Promise<void> {
  await db
    .insert(jobRunSteps)
    .values({ jobId: claimed.jobId, runId: claimed.runId, step, completedAt: new Date(clock.now()), detail })
    .onConflictDoNothing({ target: [jobRunSteps.jobId, jobRunSteps.step] });
}

/** The resume read: which of this job's steps are already done, across every attempt. */
export async function completedStepsFor(db: Db, jobId: number): Promise<ReadonlySet<string>> {
  const rows = await db.select({ step: jobRunSteps.step }).from(jobRunSteps).where(eq(jobRunSteps.jobId, jobId));
  return new Set(rows.map((row) => row.step));
}
