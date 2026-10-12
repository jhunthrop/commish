// THE LOCAL RUNNER — the crontab's replacement: a long-lived process that ticks the schedule
// catch-up and works the queue every `JOBS_CONFIG.localTickIntervalMs`. Kept alive by launchd
// (`scripts/install-season-runner.sh`: KeepAlive + RunAtLoad), which is what closes the
// laptop-asleep hole cron never could — launchd restarts this process on wake, the first tick
// computes the fires sleep swallowed, and the queue does the rest.
//
// Run: npm run jobs:runner
// One tick and exit (an operator smoke test, or an external scheduler): npm run jobs:runner -- --once
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { createDb } from "@research-ts/db/client";
import { JOBS_CONFIG } from "@/jobs/config";
import { formatErrorForLog } from "@/jobs/execute";
import { JOB_DEFINITIONS } from "@/jobs/registry";
import { runTick, type TickReport } from "@/jobs/runner";
import { UNGATED_WAKE_SET } from "@/jobs/wake";

const state = { stopping: false };

function printReport(report: TickReport): void {
  const fired = report.schedules.flatMap((schedule) => schedule.enqueued.map((fire) => `${schedule.schedule}@${fire}`));
  const quiet = fired.length === 0 && report.reclaimed.length === 0 && report.executed.length === 0;
  if (quiet) return; // a silent minute is a silent log; the interesting ticks stand out

  console.log(`[jobs] tick at ${report.startedAt} (${report.elapsedMs}ms, stopped: ${report.stoppedBecause})`);
  for (const fire of fired) console.log(`[jobs]   enqueued ${fire}`);
  for (const reclaim of report.reclaimed) {
    console.log(`[jobs]   reclaimed job ${reclaim.jobId} "${reclaim.name}" attempt ${reclaim.attempt}: ${reclaim.disposition}`);
  }
  for (const execution of report.executed) {
    // Dead-letter banners are printed by runTick itself (console.error); this is the ordinary line.
    console.log(
      `[jobs]   ran job ${execution.jobId} "${execution.name}" attempt ${execution.attempt}: ${execution.outcome}` +
        (execution.nextRunAt === undefined ? "" : ` (next at ${execution.nextRunAt})`),
    );
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const db = createDb();
  const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  // Ungated on purpose: a local Postgres has no compute to suspend, and the wake gate exists only
  // to let Neon's suspend (see `@/jobs/wake`). This runner checks everything every tick.
  const deps = { db, clock: { now: () => new Date().toISOString() }, random: Math.random, workerId, wake: UNGATED_WAKE_SET };

  const stop = (signal: string): void => {
    console.log(`[jobs] ${signal} received; finishing the in-flight tick, then exiting.`);
    state.stopping = true;
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  console.log(`[jobs] runner ${workerId} starting: ${JOB_DEFINITIONS.size} job definition(s), tick every ${JOBS_CONFIG.localTickIntervalMs}ms.`);
  try {
    while (!state.stopping) {
      try {
        printReport(await runTick(deps, JOB_DEFINITIONS, { budgetMs: JOBS_CONFIG.localTickBudgetMs, maxJobs: JOBS_CONFIG.localTickMaxJobs }));
      } catch (error: unknown) {
        // A tick that failed whole (db unreachable mid-restart) is a log line, not a crash: the
        // next tick retries, and launchd's KeepAlive covers the crashes this catch cannot.
        // Scrubbed text, never the raw object (its stack and causes bypass a message-only scrub).
        console.error(`[jobs] tick failed: ${formatErrorForLog(error)}`);
      }
      if (once || state.stopping) break;
      await new Promise((resolve) => setTimeout(resolve, JOBS_CONFIG.localTickIntervalMs));
    }
  } finally {
    await db.$client.end();
  }
  console.log("[jobs] runner stopped clean.");
}

main().catch((error: unknown) => {
  console.error(formatErrorForLog(error));
  process.exitCode = 1;
});
