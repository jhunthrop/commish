/**
 * THE PACER (draft-room performance round, item 3): bot pacing as one queued job per pick. After
 * any accepted action, whoever applied it asks the pacer for the room's next due instant — the
 * on-clock bot's seeded think-delay past the turn's start, or the clock's own deadline — and the
 * pacer enqueues ONE `draft-advance` job for it, keyed by the log sequence it was scheduled from,
 * then asks the self-wake to run it at that instant in its own invocation. The job's invocation
 * makes the pick (stamped at its due instant, byte-identical to what any driver would stamp),
 * publishes, computes the room's facts and paces the next. Nothing depends on a stream being
 * open: a room nobody is watching advances on the same schedule as a watched one, and the minute
 * sweep is the safety net only (`draft-sweep-job.ts` leaves a room with a live pacing job alone).
 *
 * ONE JOB PER SEQUENCE. The idempotency key names the sequence, so two drivers pacing the same
 * state enqueue one job; a job whose sequence the log has moved past is a no-op when it runs and
 * is RETIRED by the pacer that schedules the newer sequence, so a sleeping wake never waits a
 * whole clock on a deadline a human has already beaten.
 *
 * WHERE IT IS OFF. The in-process dev ticker paces a local room already; the jobs pace where no
 * long-lived process exists (Vercel) or where a deployment says so (`JOBS_SELF_URL`, the
 * measurement harness's `next start`). `pacingEnabledIn` reads that from the env once.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobs } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { DraftState } from "@/draft-engine";
import { JOBS_CONFIG } from "@/jobs/config";
import { DRAFT_ADVANCE_JOB_NAME, draftAdvanceIdempotencyKey, draftAdvanceJob } from "@/jobs/defs/draft-advance-job";
import { getSelfWake, NO_SELF_WAKE, type SelfWake } from "@/jobs/self-wake";
import { enqueueJob, retirePendingJobs } from "@/jobs/store";
import type { EnvRecord } from "@/jobs/tick-auth";
import { wakeSet, type WakeSet } from "@/jobs/wake";
import type { MockBotDriver } from "@/mock-draft-service/driver";
import { nextDueInstantMs, type AdvanceOutcome } from "./advance";
import { DRAFT_ADVANCE_CONFIG } from "./config";
import type { DraftStore } from "./store";

export interface DraftPacerDeps {
  readonly db: Db;
  readonly clock: Clock;
  readonly mockDriver: MockBotDriver;
  /** Defaults to the installed wake set (`wakeSet()`); the enqueue registers the job's instant in it. */
  readonly wake?: WakeSet;
  /** Defaults to the process-wide self-wake; tests hand in a recorder or `NO_SELF_WAKE`. */
  readonly selfWake?: SelfWake;
}

export type PaceOutcome =
  | { readonly kind: "scheduled"; readonly jobId: number; readonly dueAt: string; readonly retired: number }
  | { readonly kind: "already-scheduled"; readonly dueAt: string }
  | { readonly kind: "nothing-due" };

export interface PaceOptions {
  /** An action just landed on the wire: the next is applied no sooner than the wire floor
   *  (`DRAFT_ADVANCE_CONFIG.minPickSpacingMs`) from now, whatever its own instant says. */
  readonly afterLanding?: boolean;
}

export interface DraftPacer {
  /** Paces from a state in hand (the store's post-commit hook; a job that stopped at its budget). */
  pace(state: DraftState, options?: PaceOptions): Promise<PaceOutcome>;
  /** Paces from an advance outcome that ran to a quiet end (nothing due yet: its `nextDueAt` is
   *  the room's true next instant). An exhausted outcome names "now", not the next instant, so
   *  a job that stopped at its budget paces from the fresh state instead. */
  paceFromOutcome(outcome: AdvanceOutcome): Promise<PaceOutcome>;
}

const present = (value: string | undefined): boolean => value !== undefined && value !== "";

/** Whether this process paces rooms through jobs (see the module docblock). */
export function pacingEnabledIn(env: EnvRecord): boolean {
  return present(env.VERCEL) || present(env.JOBS_SELF_URL);
}

export function createDraftPacer({ db, clock, mockDriver, wake, selfWake }: DraftPacerDeps): DraftPacer {
  const wakeFor = (): SelfWake => selfWake ?? getSelfWake();

  /** Pending pacing jobs of this draft scheduled from an OLDER sequence: retired, see the docblock. */
  async function retireOlder(draftId: string, sequence: number): Promise<number> {
    const pending = await db
      .select({ id: jobs.id, payload: jobs.payload })
      .from(jobs)
      .where(and(eq(jobs.name, DRAFT_ADVANCE_JOB_NAME), eq(jobs.status, "pending"), forDraft(draftId)));
    const stale = pending.filter((row) => typeof row.payload.sequence === "number" && row.payload.sequence < sequence).map((row) => row.id);
    return retirePendingJobs(db, clock, stale);
  }

  async function schedule(draftId: string, sequence: number, instantMs: number, afterLanding: boolean): Promise<PaceOutcome> {
    // The wire floor (`DRAFT_ADVANCE_CONFIG.minPickSpacingMs`): an instant already at hand behind
    // a pick that just landed is applied no sooner than the floor from now, never in the same
    // breath. The action's stamp is untouched; only its landing moves, and only when late.
    const dueAtMs = afterLanding ? Math.max(instantMs, Date.parse(clock.now()) + DRAFT_ADVANCE_CONFIG.minPickSpacingMs) : instantMs;
    const dueAt = new Date(dueAtMs).toISOString();
    const result = await enqueueJob(
      db,
      clock,
      { name: DRAFT_ADVANCE_JOB_NAME, idempotencyKey: draftAdvanceIdempotencyKey(draftId, sequence), payload: { draftId, sequence }, maxAttempts: draftAdvanceJob.maxAttempts, runAt: new Date(dueAtMs) },
      wake ?? wakeSet(),
    );
    if (!result.enqueued || result.jobId === null) return { kind: "already-scheduled", dueAt };
    const retired = await retireOlder(draftId, sequence);
    wakeFor().wake(result.jobId, dueAtMs, draftId);
    return { kind: "scheduled", jobId: result.jobId, dueAt, retired };
  }

  return {
    async pace(state, options = {}) {
      const dueAtMs = await nextDueInstantMs(state, mockDriver);
      if (dueAtMs === null) return { kind: "nothing-due" };
      return schedule(state.config.draftId, state.sequence, dueAtMs, options.afterLanding ?? false);
    },
    async paceFromOutcome(outcome) {
      if (outcome.outcome !== "ok" || outcome.exhausted || outcome.nextDueAt === null || outcome.sequence === null || outcome.phase !== "in_progress") return { kind: "nothing-due" };
      return schedule(outcome.draftId, outcome.sequence, Date.parse(outcome.nextDueAt), outcome.applied > 0);
    },
  };
}

/** The pacer that paces nothing: a process whose rooms the dev ticker drives. */
export const NO_OP_PACER: DraftPacer = {
  pace: async () => ({ kind: "nothing-due" }),
  paceFromOutcome: async () => ({ kind: "nothing-due" }),
};

/**
 * What a job owes after its advance (`draft-advance-job.ts`): a call that stopped at its one
 * action reports "now" as its next instant, so the next is read off the fresh state and floored;
 * a call that ran to a quiet end carries the room's true next instant already.
 */
export async function paceAfterAdvance(pacer: DraftPacer, store: DraftStore, outcome: AdvanceOutcome): Promise<PaceOutcome> {
  if (!outcome.exhausted) return pacer.paceFromOutcome(outcome);
  const fresh = await store.getDraftState(outcome.draftId);
  return fresh === null ? { kind: "nothing-due" } : pacer.pace(fresh, { afterLanding: outcome.applied > 0 });
}

/** Pending pacing jobs by draft id, for the sweep's own read (`inArray` keeps it one statement). */
export async function pendingPacingJobs(db: Db, statuses: readonly ("pending" | "running")[] = ["pending", "running"]): Promise<ReadonlyMap<string, { readonly runAt: Date; readonly status: string }>> {
  const rows = await db.select({ payload: jobs.payload, runAt: jobs.runAt, status: jobs.status }).from(jobs).where(and(eq(jobs.name, DRAFT_ADVANCE_JOB_NAME), inArray(jobs.status, [...statuses])));
  const byDraft = new Map<string, { readonly runAt: Date; readonly status: string }>();
  for (const row of rows) {
    const draftId = row.payload.draftId;
    if (typeof draftId !== "string") continue;
    const held = byDraft.get(draftId);
    // The newest instant wins: it is the one the chain is actually waiting on.
    if (held === undefined || row.runAt.getTime() > held.runAt.getTime()) byDraft.set(draftId, { runAt: row.runAt, status: row.status });
  }
  return byDraft;
}

export interface PacingChain {
  readonly runAt: Date;
  readonly status: string;
}

/**
 * Whether a pacing job is on its way (the rule the sweep and advance-on-read share): pending and
 * inside the grace past its instant (`JOBS_CONFIG.pacingChainGraceMs`), or running and younger
 * than one sleep ceiling plus that grace. A running job older than that is an invocation that
 * died after its pick committed and before it paced (review fix round, finding 2): the reclaim
 * will requeue it, but the room must not wait the reclaim's two minutes for that.
 */
export function isPacingChainLive(chain: PacingChain | undefined, nowMs: number): boolean {
  if (chain === undefined) return false;
  const ageMs = nowMs - chain.runAt.getTime();
  return chain.status === "running" ? ageMs < JOBS_CONFIG.selfWakeMaxSleepMs + JOBS_CONFIG.pacingChainGraceMs : ageMs < JOBS_CONFIG.pacingChainGraceMs;
}

/** The one-draft predicate over the payload, so a per-room read never scans every room's rows. */
const forDraft = (draftId: string) => sql`${jobs.payload}->>'draftId' = ${draftId}`;

/** Whether `draftId` has a pacing job on its way (`isPacingChainLive`). */
export async function hasLivePacingJob(db: Db, draftId: string, nowMs: number): Promise<boolean> {
  const rows = await db
    .select({ runAt: jobs.runAt, status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.name, DRAFT_ADVANCE_JOB_NAME), inArray(jobs.status, ["pending", "running"]), forDraft(draftId)));
  const newest = rows.reduce<PacingChain | undefined>((held, row) => (held === undefined || row.runAt.getTime() > held.runAt.getTime() ? row : held), undefined);
  return isPacingChainLive(newest, nowMs);
}

export { NO_SELF_WAKE };
