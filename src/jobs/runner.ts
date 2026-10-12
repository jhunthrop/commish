// THE RUNNER SEAM — `runTick` is the ONE function both runners call: the long-lived local
// process (`scripts/jobs-runner.ts`) with a generous budget, and the Vercel Cron route
// (`src/app/api/jobs/tick/route.ts`) with a budget sized under the function-duration cap. One
// tick = schedule catch-up, stale reclaim, then a bounded drain of the queue. Everything a tick
// did comes back as a structured report; the callers decide what to print or return.
//
// GATED ON THE WAKE SET (Neon cost audit 2026-09-07, finding 1). The tick reads `deps.wake` once
// — one Redis round trip — and lets that reading decide which of its three Postgres touches run:
// the reclaim scan only when a claimed attempt may have turned stale, the claim loop only when a
// queued job may be eligible (or a schedule just fired, so the queue is known non-empty), and the
// draft sweep's schedule only when a draft registered a due instant. The members it acted on are
// removed BEFORE acting, so a registration that races this tick survives for the next one. An
// idle minute therefore issues zero statements, which is what lets Neon's compute suspend. The
// ungated set (`UNGATED_WAKE_SET`, what an uninstalled process and the local runner use) reports
// everything due, which is exactly the tick as it was before the gate.
import type { Db } from "@research/db/client";
import type { Clock } from "@research/domain/timing";
import type { AnyJobDefinition } from "./contract";
import { executeClaimedJob, type ExecutionReport } from "./execute";
import { tickSchedules, type ScheduleMemory, type ScheduleTickReport } from "./schedule";
import type { ScheduleDefinition } from "./schedules";
import { claimNextJob, reclaimStaleJobs, type ReclaimedJob } from "./store";
import { wakeSet, type WakeDue, type WakeSet } from "./wake";

export interface RunnerDeps {
  readonly db: Db;
  readonly clock: Clock;
  readonly random: () => number;
  readonly workerId: string;
  /** Real elapsed milliseconds for the tick budget — separate from the domain `clock` on
   *  purpose: the budget guards against the PLATFORM's wall clock (a Vercel function's duration
   *  cap), which a test's frozen domain clock must not fake. Defaults to `Date.now`. */
  readonly monotonicNow?: () => number;
  /** The wake gate. Defaults to the installed set (`wakeSet()`), which is ungated until
   *  `src/instrumentation.ts` installs the Redis one. */
  readonly wake?: WakeSet;
  /** Test seam over the process-wide schedule memory (`createScheduleMemory`). */
  readonly scheduleMemory?: ScheduleMemory;
}

export interface TickOptions {
  readonly budgetMs: number;
  readonly maxJobs: number;
  /** Test seam: which schedules this tick evaluates. Defaults to the real `SCHEDULES`. */
  readonly schedules?: readonly ScheduleDefinition[];
}

export interface TickReport {
  readonly startedAt: string;
  readonly schedules: readonly ScheduleTickReport[];
  readonly reclaimed: readonly ReclaimedJob[];
  readonly executed: readonly ExecutionReport[];
  /** `idle`: the wake set said nothing could be eligible, so the claim loop never ran. */
  readonly stoppedBecause: "queue-drained" | "max-jobs" | "budget" | "idle";
  readonly elapsedMs: number;
}

/** Claiming with less headroom than this left would start work the tick cannot host; the job
 *  stays queued for the next tick instead. */
const MIN_CLAIM_HEADROOM_MS = 2_000;

export async function runTick(deps: RunnerDeps, definitions: ReadonlyMap<string, AnyJobDefinition>, options: TickOptions): Promise<TickReport> {
  const monotonicNow = deps.monotonicNow ?? Date.now;
  const startedAtMs = monotonicNow();
  const deadline = startedAtMs + options.budgetMs;
  const startedAt = deps.clock.now();
  const wake = deps.wake ?? wakeSet();

  const due = await wake.due(Date.parse(startedAt));
  await wake.remove(due.members);

  const schedules = await tickSchedules(deps.db, deps.clock, definitions, options.schedules, { memory: deps.scheduleMemory, wake, wakeDue: due });
  const reclaimed = due.reclaim ? await reclaimStaleJobs(deps.db, deps.clock, wake) : [];

  const executed: ExecutionReport[] = [];
  const stoppedBecause = shouldClaim(due, schedules) ? await drain({ ...deps, wake }, definitions, options, deadline, monotonicNow, executed) : "idle";

  for (const report of executed) {
    if (report.outcome === "dead-lettered") {
      // THE LOUD PART of the dead-letter contract: a terminal failure must be impossible to miss
      // in the runner's own output too, not only on the admin page.
      console.error(
        `[jobs] DEAD-LETTER: job ${report.jobId} "${report.name}" failed terminally on attempt ${report.attempt} (${report.errorKind ?? "unknown"}): ${report.error ?? "no error text"}`,
      );
    }
  }

  return { startedAt, schedules, reclaimed, executed, stoppedBecause, elapsedMs: monotonicNow() - startedAtMs };
}

/** A schedule that fired (or found its fire already queued) makes the queue known non-empty, so
 *  the claim runs whether or not the wake set named a job — the fallback that keeps a lost Redis
 *  registration from stranding a queued fire. */
function shouldClaim(due: WakeDue, schedules: readonly ScheduleTickReport[]): boolean {
  return due.claim || schedules.some((report) => report.enqueued.length > 0 || report.deduped > 0);
}

async function drain(
  deps: RunnerDeps & { readonly wake: WakeSet },
  definitions: ReadonlyMap<string, AnyJobDefinition>,
  options: TickOptions,
  deadline: number,
  monotonicNow: () => number,
  executed: ExecutionReport[],
): Promise<TickReport["stoppedBecause"]> {
  while (executed.length < options.maxJobs) {
    const remaining = deadline - monotonicNow();
    if (remaining < MIN_CLAIM_HEADROOM_MS) return "budget";

    const claimed = await claimNextJob(deps.db, deps.clock, deps.workerId, deps.wake);
    if (claimed === null) return "queue-drained";

    // Re-read the clock AFTER the claim (fix round, LOW-5): the claim's own round trip spends
    // budget, and a cap computed before it would promise the job time the tick no longer has.
    const remainingAfterClaim = Math.max(1, deadline - monotonicNow());
    executed.push(await executeClaimedJob(deps, definitions, claimed, { timeoutCapMs: remainingAfterClaim }));
  }
  return "max-jobs";
}
