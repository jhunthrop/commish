// THE JOB CONTRACT — what a job IS to this system: a named sequence of idempotent steps, with an
// attempt budget, a per-attempt timeout, and a backoff policy. Definitions live in code
// (src/jobs/defs/, collected by src/jobs/registry.ts); the queue rows (src/db/schema.ts `jobs`)
// carry only what scheduling needs. Spec: docs/superpowers/specs/2026-09-02-job-system-design.md.
import type { Db } from "@research/db/client";
import type { JsonObject } from "@research/domain/json";
import type { Clock } from "@research/domain/timing";

/**
 * A failure the job itself is REFUSING, not suffering — retrying would either be useless or would
 * paper over a gate that exists on purpose. The canonical case is the register's freeze refusal:
 * a freeze refused for being past kickoff must never be retried until it lands late anyway. A
 * step that throws this fails the JOB immediately: status `failed`, dead-letter, loud, no retry.
 * Every other thrown error is retryable up to the definition's `maxAttempts`.
 */
export class TerminalJobError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "TerminalJobError";
  }
}

/** Exponential backoff with jitter: attempt N waits `min(maxMs, baseMs * 2^(N-1))`, jittered to
 *  50-100% of that so a herd of same-instant failures does not retry as a herd (`backoff.ts`). */
export interface BackoffPolicy {
  readonly baseMs: number;
  readonly maxMs: number;
}

/** What a completed step reports — recorded on the checkpoint row (`job_run_steps.detail`) for
 *  the admin page. Display data only; the executor's skip logic reads step NAMES, never this. */
export interface StepOutcome {
  readonly summary: string;
  readonly detail: readonly string[];
}

/** What a step gets to work with. Deliberately small: the db, the injected clock, and nothing
 *  ambient — a step that needs the network takes it through its definition's own closure, the
 *  same dependency-injection shape `SeasonWeekDeps` already uses. */
export interface JobStepContext {
  readonly db: Db;
  readonly clock: Clock;
  /**
   * THE MOMENT THIS ATTEMPT WILL BE CUT OFF (capsule acceptance round review, C1) — the executor's
   * own `min(definition.timeoutMs, timeoutCapMs)` deadline as an instant, where `timeoutCapMs` is
   * whatever is left of the TICK's budget (`JOBS_CONFIG.vercelTickBudgetMsDefault`, 50s by
   * default), not the job's own generous `timeoutMs`.
   *
   * A step that does bounded work per item reads this and stops one item early rather than being
   * killed mid-batch: the capsule sweep processes players until one more would cross it, then
   * enqueues its own continuation. A step that ignores it behaves exactly as it always did, which
   * is why this is optional rather than a contract every step must now honour.
   */
  readonly deadlineAt?: Date;
}

/**
 * One named idempotent step. The name is the checkpoint key: when the step resolves, a
 * `job_run_steps` row is appended under it, and every later attempt or resumed tick SKIPS steps
 * already recorded — which is what lets one job finish across several bounded Vercel ticks.
 * Idempotency is the step author's obligation, exactly as it already was under cron.
 */
export interface JobStep<P> {
  readonly name: string;
  readonly run: (ctx: JobStepContext, payload: P) => Promise<StepOutcome>;
}

export interface JobDefinition<P> {
  /** The registry key — what `jobs.name` stores. */
  readonly name: string;
  /** Run in order; each is skipped once its checkpoint row exists. Names must be unique. */
  readonly steps: readonly JobStep<P>[];
  readonly maxAttempts: number;
  /** Per-attempt budget. An attempt that outlives it fails as retryable (`error_kind: timeout`);
   *  the runner also refuses to CLAIM a job whose timeout no longer fits its remaining tick
   *  budget, which is what keeps the Vercel handler exiting clean instead of being killed. */
  readonly timeoutMs: number;
  readonly backoff: BackoffPolicy;
  /** The boundary validation: raw stored payload in, typed payload out, throw (terminal) on
   *  garbage — a job whose stored payload cannot parse must dead-letter, not retry. */
  readonly parsePayload: (raw: JsonObject) => P;
}

/** Existential wrapper for the registry: the payload type is sealed inside the definition, so the
 *  executor can hold a heterogeneous list without `any`. */
export interface AnyJobDefinition {
  readonly name: string;
  readonly stepNames: readonly string[];
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly backoff: BackoffPolicy;
  /** Runs the steps whose names are NOT in `completedSteps`, in definition order, calling
   *  `onStepComplete` as each finishes. Implemented once, in `defineJob`. */
  readonly runRemainingSteps: (
    ctx: JobStepContext,
    rawPayload: JsonObject,
    completedSteps: ReadonlySet<string>,
    onStepComplete: (step: string, outcome: StepOutcome) => Promise<void>,
  ) => Promise<void>;
}

/** Seals a typed definition into the registry shape, and validates it once at module load:
 *  duplicate step names would silently break checkpoint resume, so they refuse loudly here. */
export function defineJob<P>(definition: JobDefinition<P>): AnyJobDefinition {
  const names = definition.steps.map((step) => step.name);
  if (new Set(names).size !== names.length) {
    throw new Error(`job "${definition.name}" has duplicate step names: ${names.join(", ")}`);
  }
  if (definition.steps.length === 0) throw new Error(`job "${definition.name}" has no steps.`);
  if (definition.maxAttempts < 1) throw new Error(`job "${definition.name}" needs maxAttempts >= 1.`);
  return {
    name: definition.name,
    stepNames: names,
    maxAttempts: definition.maxAttempts,
    timeoutMs: definition.timeoutMs,
    backoff: definition.backoff,
    runRemainingSteps: async (ctx, rawPayload, completedSteps, onStepComplete) => {
      const payload = parseTerminally(definition, rawPayload);
      for (const step of definition.steps) {
        if (completedSteps.has(step.name)) continue;
        const outcome = await step.run(ctx, payload);
        await onStepComplete(step.name, outcome);
      }
    },
  };
}

/** A payload that cannot parse is a job that can never succeed: classified terminal here, once,
 *  rather than each definition remembering to wrap its own validation. */
function parseTerminally<P>(definition: JobDefinition<P>, raw: JsonObject): P {
  try {
    return definition.parsePayload(raw);
  } catch (error: unknown) {
    throw new TerminalJobError(
      `job "${definition.name}" payload did not parse: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
