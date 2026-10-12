// THE CAPSULE SWEEP AS A LEAGUE-APP JOB. The sweep itself is the research core's
// (`@research-ts/capsules/sweep`); this binding owns what belongs to this app's queue: the payload, the tick
// deadline, the continuation it enqueues for itself, the precomputed peek rows written from the
// sweep's facts pass, the peek-document rebuild for every player written, and the board memo drop.
//
// TERMINAL VS RETRYABLE: the sweep never fails on a player (the template is the permanent floor);
// what can throw is the database work around it, which is ordinary retryable weather.
import type { Db } from "@research-ts/db/client";
import type { JsonObject } from "@research-ts/domain/json";
import type { Clock } from "@research-ts/domain/timing";
import { CAPSULE_CONFIG } from "@research-ts/capsules/config";
import { describeSweep, reservedMsPerPlayer, sweepCapsules, type CapsuleSweepDeps } from "@research-ts/capsules/sweep";
import { writeRefresh } from "@/league-service/peek/peek-facts";
import { BOARD_MEMO_GROUP, invalidateTtlMemoGroup } from "@research-ts/lib/cache/ttl-memo";
import { JOBS_CONFIG } from "../config";
import { defineJob, type AnyJobDefinition, type JobStepContext, type StepOutcome } from "../contract";
import { enqueueJob } from "../store";
import { enqueuePeekDocumentRebuildsQuietly } from "./peek-document-job";

export const CAPSULE_SWEEP_JOB_NAME = "capsule-sweep";

export interface CapsuleSweepPayload {
  /** Overrides `CAPSULE_CONFIG.sweepGenerationBudget` for this run only — an operator's manual
   *  rerun with a wider budget, mainly, and the CONTINUATION's own remaining share of tonight's
   *  cap. Optional; the schedule's own fire never sets it. */
  readonly budget?: number;
  /** Set only on a continuation this job enqueued for itself: the instant the night's first run
   *  started, which keeps every continuation's idempotency key inside one chain and lets a reader
   *  of the jobs table see one night's work as one sequence. */
  readonly continuationOf?: string;
}

export function parseCapsuleSweepPayload(raw: JsonObject): CapsuleSweepPayload {
  const { budget, continuationOf } = raw;
  if (budget !== undefined && (typeof budget !== "number" || !Number.isInteger(budget) || budget < 1)) {
    throw new Error(`capsule-sweep payload: budget must be a positive integer, got ${JSON.stringify(budget)}.`);
  }
  if (continuationOf !== undefined && (typeof continuationOf !== "string" || Number.isNaN(Date.parse(continuationOf)))) {
    throw new Error(`capsule-sweep payload: continuationOf must be an ISO instant string, got ${JSON.stringify(continuationOf)}.`);
  }
  return {
    ...(budget === undefined ? {} : { budget }),
    ...(continuationOf === undefined ? {} : { continuationOf }),
  };
}

export async function runCapsuleSweepStep(
  db: Db,
  clock: Clock,
  deps: CapsuleSweepDeps,
  payload: CapsuleSweepPayload,
  deadlineAt?: Date,
): Promise<StepOutcome> {
  const report = await sweepCapsules(db, clock, deps, { budget: payload.budget, deadlineAt }, {
    // THE PRECOMPUTED PEEK ROWS (peek-facts design §3.2) ride on the pass, before any gateway call.
    afterFacts: async (pass) => {
      const peek = await writeRefresh(db, pass);
      return `Peek facts: ${peek.players} rows built, ${peek.changed} changed, ${peek.withTouchesRank} with a touches rank`;
    },
  });
  // THE EVENT (peek document design §3.4, row two): a written capsule is a changed document input.
  // The reason stamp is this pass's own instant, so a retried tick coalesces into one build.
  if (report.processed.length > 0) {
    await enqueuePeekDocumentRebuildsQuietly(db, clock, { playerIds: report.processed, reason: `capsule:${report.asOf.toISOString()}` });
  }
  // THE CONTINUATION (review C1): tonight's cap minus what this run wrote, enqueued to run now so
  // the next tick claims it.
  if (report.continuation !== null) {
    const continuationOf = payload.continuationOf ?? report.asOf.toISOString();
    const { budgetLeft } = report.continuation;
    await enqueueJob(db, clock, {
      name: CAPSULE_SWEEP_JOB_NAME,
      idempotencyKey: `capsule-sweep-continue@${continuationOf}#${budgetLeft}`,
      payload: { budget: budgetLeft, continuationOf },
      maxAttempts: 2,
      runAt: new Date(clock.now()),
    });
  }
  // Every memo built on the served board is dropped once the run has written (site search fix
  // round, 2026-09-08), so a fresh board reaches the search index on the next request.
  invalidateTtlMemoGroup(BOARD_MEMO_GROUP);
  const budgetLine = report.wroteNothingInTime
    ? [
        `budget: this attempt had less than the ${reservedMsPerPlayer() / 1000}s one player needs, so nothing was written. ` +
          `The tick budget (JOBS_TICK_BUDGET_MS, default ${JOBS_CONFIG.vercelTickBudgetMsDefault / 1000}s) is what caps an attempt, never this job's own timeout.`,
      ]
    : [];
  return { summary: describeSweep(report), detail: [...report.detail, ...budgetLine] };
}

export const capsuleSweepJob: AnyJobDefinition = defineJob<CapsuleSweepPayload>({
  name: CAPSULE_SWEEP_JOB_NAME,
  maxAttempts: 2,
  // Not the number that binds an attempt: the runner cuts a claimed attempt at the TICK budget
  // (at most 280s), and the step hands the rest of the night to a continuation before that. This
  // only has to sit above the largest tick with headroom.
  timeoutMs: 480_000,
  backoff: { baseMs: 60_000, maxMs: 10 * 60_000 },
  parsePayload: parseCapsuleSweepPayload,
  steps: [
    {
      name: "sweep",
      run: (ctx: JobStepContext, payload) =>
        runCapsuleSweepStep(ctx.db, ctx.clock, { apiKey: process.env[CAPSULE_CONFIG.gateway.envVars.apiKey] ?? "" }, payload, ctx.deadlineAt),
    },
  ],
});
