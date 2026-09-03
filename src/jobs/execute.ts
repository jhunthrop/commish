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
  isSupersededAttempt,
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
  /** `superseded`: this attempt was reclaimed mid-flight and a newer attempt owns the job; the
   *  zombie's late finish was rejected by the append-only trigger and discarded. Nothing to do —
   *  the reclaimed job is already pending (or dead-lettered) under its own bookkeeping. */
  readonly outcome: "succeeded" | "retry-scheduled" | "dead-lettered" | "superseded";
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
 * Stored and logged error text must never carry a secret. Handlers should already keep env
 * values out of their messages (the odds module's own discipline), but the executor scrubs
 * regardless — and by CONVENTION, not by a hand-kept list (fix round, MEDIUM-3: the hand list
 * had already missed ANTHROPIC_API_KEY): every env var whose NAME matches the secret-shaped
 * pattern contributes its value, unioned with the five explicit names, so the next secret added
 * to .env.local is scrubbed the day it exists. Derived per call, so tests plant fakes and
 * long-lived runners see rotated values.
 */
const EXPLICIT_SECRET_KEYS = ["ODDS_API_KEY", "CRON_SECRET", "DATABASE_URL", "TANK01_API_KEY", "WORKOS_API_KEY"] as const;
const SECRET_NAME_PATTERN = /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/;
/** A pattern-matched NAME with a tiny value ("1", "on") would scrub that substring out of every
 *  error in the system, so the heuristic keeps a length floor. The EXPLICIT keys take no floor
 *  (fix round 2, MEDIUM-C): a short CRON_SECRET is still the real secret, and a var we named by
 *  hand is never a false positive — any non-empty value scrubs. */
const MIN_SECRET_VALUE_LENGTH = 6;

type ScrubEnv = Readonly<Record<string, string | undefined>>;

function secretValuesByKey(env: ScrubEnv): readonly (readonly [string, string])[] {
  const explicit = new Set<string>(EXPLICIT_SECRET_KEYS);
  return Object.entries(env)
    .filter((entry): entry is [string, string] => {
      const [key, value] = entry;
      if (value === undefined || value.length === 0) return false;
      if (explicit.has(key)) return true;
      return SECRET_NAME_PATTERN.test(key) && value.length >= MIN_SECRET_VALUE_LENGTH;
    })
    // Longest value first, so a secret that contains another (DATABASE_URL carrying a password
    // that is also its own var) is scrubbed whole before its fragment is.
    .sort((a, b) => b[1].length - a[1].length);
}

export function scrubSecrets(text: string, env: ScrubEnv = process.env): string {
  return secretValuesByKey(env).reduce((scrubbed, [key, value]) => scrubbed.replaceAll(value, `[${key}]`), text);
}

/**
 * Everything worth logging about an error — message, stack, and the whole cause chain,
 * recursively — with every secret scrubbed. EVERY console line in the job system that prints an
 * error goes through this rather than handing the raw object to console.error, because a raw
 * object's stack and nested causes bypass a message-only scrub.
 */
export function formatErrorForLog(error: unknown, env: ScrubEnv = process.env): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const walk = (current: unknown): void => {
    if (current === undefined || current === null || seen.has(current) || parts.length >= 8) return;
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.stack ?? `${current.name}: ${current.message}`);
      walk(current.cause);
    } else {
      parts.push(String(current));
    }
  };
  walk(error);
  return scrubSecrets(parts.join("\ncaused by: "), env);
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
      console.error(`[jobs] heartbeat failed for job ${claimed.jobId}: ${formatErrorForLog(error)}`);
    });
  }, deps.heartbeatIntervalMs ?? JOBS_CONFIG.heartbeatIntervalMs);

  const timeoutMs = Math.max(1, Math.min(definition.timeoutMs, options.timeoutCapMs ?? Number.POSITIVE_INFINITY));
  try {
    const completed = await completedStepsFor(deps.db, claimed.jobId);
    await raceTimeout(
      definition.runRemainingSteps({ db: deps.db, clock: deps.clock }, claimed.payload, completed, async (step, outcome) => {
        await recordStepCompletion(deps.db, deps.clock, claimed, step, {
          summary: scrubSecrets(outcome.summary),
          detail: outcome.detail.map((line) => scrubSecrets(line)),
        });
      }),
      timeoutMs,
    );
    await succeedJob(deps.db, deps.clock, claimed);
    return { jobId: claimed.jobId, name: claimed.name, attempt: claimed.attempt, outcome: "succeeded" };
  } catch (error: unknown) {
    if (isSupersededAttempt(error)) return supersededReport(claimed);
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

/** The reclaim race, resolved in the loser's favor quietly: log it, report it, change nothing —
 *  the reclaim already closed this attempt's run row and requeued (or dead-lettered) the job. */
function supersededReport(claimed: ClaimedJob): ExecutionReport {
  console.warn(
    `[jobs] attempt ${claimed.attempt} of job ${claimed.jobId} "${claimed.name}" was reclaimed mid-flight; its late result was discarded (a newer attempt owns the job).`,
  );
  return { jobId: claimed.jobId, name: claimed.name, attempt: claimed.attempt, outcome: "superseded" };
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
    try {
      await recordAttemptFailure(deps.db, deps.clock, claimed, {
        error: failure.error,
        errorKind: failure.kind,
        disposition: { kind: "retry", runAt },
      });
    } catch (error: unknown) {
      if (isSupersededAttempt(error)) return supersededReport(claimed);
      throw error;
    }
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

  try {
    await recordAttemptFailure(deps.db, deps.clock, claimed, {
      error: failure.error,
      errorKind: failure.kind,
      disposition: { kind: "dead-letter" },
    });
  } catch (error: unknown) {
    if (isSupersededAttempt(error)) return supersededReport(claimed);
    throw error;
  }
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
