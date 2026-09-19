// THE SELF-WAKE'S OTHER END (draft-room performance round, item 3): everything
// `src/app/api/jobs/run/route.ts` does, with the db, definitions, env and the deferral injected
// so the route stays a wire. One authenticated POST names one queued job and its due instant;
// the handler answers 202 at once and, after the response has gone, sleeps until that instant
// and runs exactly that job (`runJobById`). The sleep lives HERE, in an invocation whose only
// purpose is this one job — never in the request that enqueued it, never on a stream. It sleeps
// in slices and checks between them that the job is still pending, so a job retired while it
// slept (the human picked before her clock ran out) ends the sleep within one slice.
//
// THE CHAIN (review fix round, finding 1): an invocation sleeps at most
// `JOBS_CONFIG.selfWakeMaxSleepMs`. A job still not due when that ceiling is reached is handed to
// a fresh invocation — this one re-arms a wake for the remainder (`SelfWake.wakeNow`) and ends —
// so a 90 s clock is two hops and a 180 s clock three, each hop retiring with the job.
import { z } from "zod";
import type { Db } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { pickPath } from "@/lib/timing/pick-path";
import { JOBS_CONFIG } from "./config";
import type { AnyJobDefinition } from "./contract";
import { formatErrorForLog } from "./execute";
import { runJobById } from "./runner";
import { getSelfWake, type JobRunRequest } from "./self-wake";
import { isJobPending } from "./store";
import { cronSecretFromEnv, isAuthorizedTick, type EnvRecord } from "./tick-auth";
import { tickBudgetMs } from "./tick-handler";

export const jobRunRequestSchema: z.ZodType<JobRunRequest> = z.object({
  jobId: z.number().int().positive(),
  dueAt: z.string().datetime(),
});

export interface RunHandlerDeps {
  readonly db: Db;
  readonly definitions: ReadonlyMap<string, AnyJobDefinition>;
  readonly env: EnvRecord;
  readonly workerId: string;
  /** Keeps the invocation alive for the work after the response: `after()` on the route. */
  readonly defer: (work: () => Promise<void>) => void;
  /** Re-arms a wake for a job still not due at the sleep ceiling. Defaults to the process-wide
   *  self-wake's `wakeNow`; a test records the hops. */
  readonly rewake?: (jobId: number, dueAtMs: number) => Promise<void>;
  /** Test seams. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly sleepSliceMs?: number;
  readonly maxSleepMs?: number;
}

export interface JobRunAccepted {
  readonly accepted: true;
  readonly jobId: number;
  /** How long this invocation sleeps before claiming or re-arming, after the response. */
  readonly sleepMs: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The bounded sleep: never negative, never past one invocation's ceiling. */
export function sleepUntilMs(dueAtMs: number, nowMs: number, maxSleepMs: number = JOBS_CONFIG.selfWakeMaxSleepMs): number {
  return Math.min(maxSleepMs, Math.max(0, dueAtMs - nowMs));
}

type SleepOutcome = "due" | "retired" | "ceiling";

/**
 * Sleeps toward `dueAtMs` in slices, stopping early once the job is no longer pending. Answers
 * whether the job is due and worth claiming, was retired while this slept, or is still not due
 * at this invocation's ceiling (the chain's next hop).
 */
async function sleepWhilePending(deps: RunHandlerDeps, jobId: number, dueAtMs: number): Promise<SleepOutcome> {
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const sliceMs = deps.sleepSliceMs ?? JOBS_CONFIG.selfWakeSleepSliceMs;
  const deadline = now() + sleepUntilMs(dueAtMs, now(), deps.maxSleepMs);
  for (let remaining = deadline - now(); remaining > 0; remaining = deadline - now()) {
    await sleep(Math.min(sliceMs, remaining));
    if (deadline - now() > 0 && !(await isJobPending(deps.db, jobId))) return "retired";
  }
  return dueAtMs > now() ? "ceiling" : "due";
}

export async function handleJobRun(request: Request, deps: RunHandlerDeps): Promise<Response> {
  let secret: string;
  try {
    secret = cronSecretFromEnv(deps.env);
  } catch {
    console.error("[jobs] run refused: CRON_SECRET is not configured.");
    return fail("Job runs are not configured.", 500);
  }
  if (!isAuthorizedTick(request.headers.get("authorization"), secret)) return fail("Not authorized.", 401);

  const parsed = await parseJson(request, jobRunRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { jobId, dueAt } = parsed.value;
  const dueAtMs = Date.parse(dueAt);
  const now = deps.now ?? Date.now;
  const sleepMs = sleepUntilMs(dueAtMs, now(), deps.maxSleepMs);
  // One line per self-woken invocation, so a measurement run can count them (`pickPath`).
  pickPath.mark("job.run", { jobId, sleepMs });

  deps.defer(async () => {
    try {
      const slept = await sleepWhilePending(deps, jobId, dueAtMs);
      if (slept === "retired") return;
      if (slept === "ceiling") {
        // Still pending and still not due: the next hop. Only a pending job is worth a hop.
        if (await isJobPending(deps.db, jobId)) await (deps.rewake ?? getSelfWake().wakeNow)(jobId, dueAtMs);
        return;
      }
      // How late the sleep ended against the instant it was asked for: the event loop's own
      // lag on this invocation's process, the number a measurement run reads (`pickPath`).
      pickPath.mark("job.wake", { jobId, lateMs: Math.max(0, now() - dueAtMs) });
      await runJobById(
        { db: deps.db, clock: { now: () => new Date().toISOString() }, random: Math.random, workerId: deps.workerId },
        deps.definitions,
        jobId,
        { budgetMs: tickBudgetMs(deps.env) },
      );
    } catch (error: unknown) {
      console.error(`[jobs] run of job ${jobId} failed: ${formatErrorForLog(error)}`);
    }
  });

  const body: JobRunAccepted = { accepted: true, jobId, sleepMs };
  return ok(body, { status: 202 });
}
