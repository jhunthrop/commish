// THE RUNNER SEAM — `runTick` is the ONE function both runners call: the long-lived local
// process (`scripts/jobs-runner.ts`) with a generous budget, and the Vercel Cron route
// (`src/app/api/jobs/tick/route.ts`) with a budget sized under the function-duration cap. One
// tick = schedule catch-up, stale reclaim, then a bounded drain of the queue. Everything a tick
// did comes back as a structured report; the callers decide what to print or return.
import type { Db } from "@/db/client";
import type { Clock } from "@/domain/timing";
import type { AnyJobDefinition } from "./contract";
import { executeClaimedJob, type ExecutionReport } from "./execute";
import { tickSchedules, type ScheduleTickReport } from "./schedule";
import type { ScheduleDefinition } from "./schedules";
import { claimNextJob, reclaimStaleJobs, type ReclaimedJob } from "./store";

export interface RunnerDeps {
  readonly db: Db;
  readonly clock: Clock;
  readonly random: () => number;
  readonly workerId: string;
  /** Real elapsed milliseconds for the tick budget — separate from the domain `clock` on
   *  purpose: the budget guards against the PLATFORM's wall clock (a Vercel function's duration
   *  cap), which a test's frozen domain clock must not fake. Defaults to `Date.now`. */
  readonly monotonicNow?: () => number;
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
  readonly stoppedBecause: "queue-drained" | "max-jobs" | "budget";
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

  const schedules = await tickSchedules(deps.db, deps.clock, definitions, options.schedules);
  const reclaimed = await reclaimStaleJobs(deps.db, deps.clock);

  const executed: ExecutionReport[] = [];
  const stoppedBecause = await drain(deps, definitions, options, deadline, monotonicNow, executed);

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

async function drain(
  deps: RunnerDeps,
  definitions: ReadonlyMap<string, AnyJobDefinition>,
  options: TickOptions,
  deadline: number,
  monotonicNow: () => number,
  executed: ExecutionReport[],
): Promise<TickReport["stoppedBecause"]> {
  while (executed.length < options.maxJobs) {
    const remaining = deadline - monotonicNow();
    if (remaining < MIN_CLAIM_HEADROOM_MS) return "budget";

    const claimed = await claimNextJob(deps.db, deps.clock, deps.workerId);
    if (claimed === null) return "queue-drained";

    // Re-read the clock AFTER the claim (fix round, LOW-5): the claim's own round trip spends
    // budget, and a cap computed before it would promise the job time the tick no longer has.
    const remainingAfterClaim = Math.max(1, deadline - monotonicNow());
    executed.push(await executeClaimedJob(deps, definitions, claimed, { timeoutCapMs: remainingAfterClaim }));
  }
  return "max-jobs";
}
