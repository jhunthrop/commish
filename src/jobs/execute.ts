// THE EXECUTOR — runs one claimed job's remaining steps under heartbeat and timeout, classifies
// whatever goes wrong (terminal, retryable, timeout), and hands the store the right disposition.
// This is the only file that decides a job's fate; the store just writes it down.
import type { Db } from "@/db/client";
import type { Clock } from "@/domain/timing";
import { backoffDelayMs } from "./backoff";
import { JOBS_CONFIG } from "./config";
import { TerminalJobError, type AnyJobDefinition } from "./contract";
import {
  completedStepsFor,
  recordAttemptFailure,
  recordHeartbeat,
  recordStepCompletion,
  succeedJob,
  type ClaimedJob,
} from "./store";

export interface ExecutorDeps {
  readonly db: Db;
  readonly clock: Clock;
  /** Jitter source for backoff — injected, never ambient `Math.random`. */
  readonly random: () => number;
  readonly workerId: string;
  /** Test seam only: shrinks the heartbeat interval so a heartbeat test does not wait 10s. */
  readonly heartbeatIntervalMs?: number;
}

export interface ExecutionReport {
  readonly jobId: number;
  readonly name: string;
  readonly attempt: number;
  readonly outcome: "succeeded" | "retry-scheduled" | "dead-lettered";
  readonly error?: string;
  readonly errorKind?: "retryable" | "terminal" | "timeout";
  readonly nextRunAt?: string;
}

/** Sentinel for the per-attempt timeout race — classified as `timeout`, retryable. */
class AttemptTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`attempt exceeded its ${timeoutMs}ms budget`);
    this.name = "AttemptTimeoutError";
  }
}

/**
 * Stored error text must never carry a secret. Handlers should already keep env values out of
 * their messages (the odds module's own discipline), but the executor scrubs regardless: any
 * present secret env value is replaced before the text touches a row or a log line. Cheap, and it
 * turns "we believe nothing interpolates the key" into "the store cannot receive it".
 */
const SECRET_ENV_KEYS = ["ODDS_API_KEY", "CRON_SECRET", "DATABASE_URL", "TANK01_API_KEY", "WORKOS_API_KEY"] as const;

export function scrubSecrets(text: string): string {
  return SECRET_ENV_KEYS.reduce((scrubbed, key) => {
    const value = process.env[key];
    return value !== undefined && value.length > 0 ? scrubbed.replaceAll(value, `[${key}]`) : scrubbed;
  }, text);
}

function errorText(error: unknown): string {
  return scrubSecrets(error instanceof Error ? error.message : String(error));
}

/**
 * Runs one claimed job. Steps already checkpointed (any attempt, any tick) are skipped; each
 * newly completed step is checkpointed the moment it resolves, so a death at any point resumes
 * from the first unrecorded step. The heartbeat rides a REAL timer, deliberately outside the
 * injected clock: it exists to prove this process is alive to `reclaimStaleJobs`, and a fake
 * clock proving fake liveness would defeat it.
 */
export interface ExecuteOptions {
  /** The runner's remaining tick budget: the attempt's timeout race runs at
   *  `min(definition.timeoutMs, timeoutCapMs)`, so a job started near the end of a bounded
   *  (Vercel) tick fails as an honest, retryable timeout instead of being killed mid-write by
   *  the platform. Checkpoints mean the next tick resumes where this one stopped. */
  readonly timeoutCapMs?: number;
}

export async function executeClaimedJob(
  deps: ExecutorDeps,
  definitions: ReadonlyMap<string, AnyJobDefinition>,
  claimed: ClaimedJob,
  options: ExecuteOptions = {},
): Promise<ExecutionReport> {
  const definition = definitions.get(claimed.name);
  if (definition === undefined) {
    // Not retryable: no later attempt will find a definition the code does not carry.
    return finishFailed(deps, claimed, {
      error: `no job definition registered under "${claimed.name}"`,
      kind: "terminal",
      maxAttempts: claimed.maxAttempts,
      backoff: JOBS_CONFIG.defaultBackoff,
    });
  }

  const heartbeat = setInterval(() => {
    void recordHeartbeat(deps.db, deps.clock, claimed.jobId).catch((error: unknown) => {
      console.error(`[jobs] heartbeat failed for job ${claimed.jobId}`, error);
    });
  }, deps.heartbeatIntervalMs ?? JOBS_CONFIG.heartbeatIntervalMs);

  const timeoutMs = Math.max(1, Math.min(definition.timeoutMs, options.timeoutCapMs ?? Number.POSITIVE_INFINITY));
  try {
    const completed = await completedStepsFor(deps.db, claimed.jobId);
    await raceTimeout(
      definition.runRemainingSteps({ db: deps.db, clock: deps.clock }, claimed.payload, completed, async (step, outcome) => {
        await recordStepCompletion(deps.db, deps.clock, claimed, step, {
          summary: scrubSecrets(outcome.summary),
          detail: outcome.detail.map(scrubSecrets),
        });
      }),
      timeoutMs,
    );
    await succeedJob(deps.db, deps.clock, claimed);
    return { jobId: claimed.jobId, name: claimed.name, attempt: claimed.attempt, outcome: "succeeded" };
  } catch (error: unknown) {
    const kind = error instanceof TerminalJobError ? "terminal" : error instanceof AttemptTimeoutError ? "timeout" : "retryable";
    return finishFailed(deps, claimed, {
      error: errorText(error),
      kind,
      maxAttempts: claimed.maxAttempts,
      backoff: definition.backoff,
    });
  } finally {
    clearInterval(heartbeat);
  }
}

interface FailureInput {
  readonly error: string;
  readonly kind: "retryable" | "terminal" | "timeout";
  readonly maxAttempts: number;
  readonly backoff: { readonly baseMs: number; readonly maxMs: number };
}

async function finishFailed(deps: ExecutorDeps, claimed: ClaimedJob, failure: FailureInput): Promise<ExecutionReport> {
  const retryable = failure.kind !== "terminal" && claimed.attempt < failure.maxAttempts;
  if (retryable) {
    const runAt = new Date(new Date(deps.clock.now()).getTime() + backoffDelayMs(failure.backoff, claimed.attempt, deps.random));
    await recordAttemptFailure(deps.db, deps.clock, claimed, {
      error: failure.error,
      errorKind: failure.kind,
      disposition: { kind: "retry", runAt },
    });
    return {
      jobId: claimed.jobId,
      name: claimed.name,
      attempt: claimed.attempt,
      outcome: "retry-scheduled",
      error: failure.error,
      errorKind: failure.kind,
      nextRunAt: runAt.toISOString(),
    };
  }

  await recordAttemptFailure(deps.db, deps.clock, claimed, {
    error: failure.error,
    errorKind: failure.kind,
    disposition: { kind: "dead-letter" },
  });
  return {
    jobId: claimed.jobId,
    name: claimed.name,
    attempt: claimed.attempt,
    outcome: "dead-lettered",
    error: failure.error,
    errorKind: failure.kind,
  };
}

/** The attempt-vs-timeout race. The losing attempt's promise keeps running (a promise cannot be
 *  cancelled) but its late result is ignored and its late step checkpoints are harmless no-ops —
 *  and on the Vercel path the function's own end kills it anyway; the heartbeat reclaim is what
 *  makes that honest. */
async function raceTimeout(work: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AttemptTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
