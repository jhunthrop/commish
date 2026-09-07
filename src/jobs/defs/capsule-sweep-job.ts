// THE PLAYER CAPSULE SWEEP (spec §9 AMENDED 2026-09-04, Task 3) — recomputes every board-relevant
// player's facts and regenerates a capsule wherever the facts hash has moved, the row is missing,
// or the existing row is still template-sourced (a 429'd or facts-outrun capsule keeps retrying
// on every sweep until the gateway lets it through, rather than freezing on its own template hash
// forever). Scheduled nightly (`schedules.ts`); also runnable on demand through the job system's
// own manual-enqueue/rerun tooling.
//
// IT IS ALSO THE PEEK-FACTS WRITER (peek-facts design §3.2, 2026-09-07). The pass this job already
// runs for the whole board is exactly the pass a precomputed peek row needs, so the rows are written
// from it here rather than by a second heavy job of its own.
//
// IT RUNS ACROSS TICKS, NOT INSIDE ONE (review C1, 2026-09-07). The runner caps a claimed job at
// whatever is left of the TICK's budget (`JOBS_CONFIG.vercelTickBudgetMsDefault`, 50s), never at
// this job's own `timeoutMs`, so a batch of 35 players at 5s pacing plus 7-20s of generation each
// could never finish inside one attempt: the step was being cut off mid-batch every night and the
// repetition check at the end never ran in production at all. The step now reads
// `ctx.deadlineAt`, stops BEFORE the player that would cross it, and enqueues its own continuation
// carrying the rest of tonight's budget. The 35 is still the per-night ceiling: the continuation's
// payload is what is left of it, never a fresh 35.
//
// THE REPETITION CHECK RUNS ONLY ON THE RUN THAT FINISHES THE NIGHT'S WORK, because it is a
// question about the whole board and a half-swept board would flag sentences the second half is
// about to rewrite anyway.
//
// TERMINAL VS RETRYABLE: `generate.ts` never throws (the template is the permanent floor), so
// nothing inside a single player's own attempt can fail this job — a gateway outage degrades every
// eligible player to template this run and the summary says so plainly. What CAN throw is the
// database work around it (`collectBoardFacts`, `writeRefresh`, `getStoredCapsulesFor`,
// `upsertCapsule`), and that is ordinary retryable weather like every other job's own DB step.
import type { Db } from "@/db/client";
import type { JsonObject } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import { CAPSULE_CONFIG } from "@/capsules/config";
import { collectBoardFacts } from "@/capsules/collect";
import { describeCapsuleFallback, generateCapsule } from "@/capsules/generate";
import { writeRefresh } from "@/capsules/peek-facts";
import { playersSayingStock, sentencesToAvoid, stockSentences } from "@/capsules/repetition";
import { getStoredCapsulesFor, queueCapsuleRegeneration, upsertCapsule, type StoredPlayerCapsule } from "@/capsules/store";
import type { PlayerFacts } from "@/capsules/facts";
import { JOBS_CONFIG } from "../config";
import { defineJob, type AnyJobDefinition, type JobStepContext, type StepOutcome } from "../contract";
import { enqueueJob } from "../store";
import { enqueuePeekDocumentRebuildsQuietly } from "./peek-document-job";

export const CAPSULE_SWEEP_JOB_NAME = "capsule-sweep";

export interface CapsuleSweepPayload {
  /** Overrides `CAPSULE_CONFIG.sweepGenerationBudget` for this run only — an operator's manual
   *  rerun with a wider budget, mainly, and the CONTINUATION's own remaining share of tonight's
   *  cap (see the module docblock). Optional; the schedule's own fire never sets it. */
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

function needsGeneration(facts: PlayerFacts, stored: StoredPlayerCapsule | undefined): boolean {
  return stored === undefined || stored.factsHash !== facts.factsHash || stored.source === "template";
}

export interface CapsuleSweepDeps {
  readonly apiKey: string;
  readonly fetch?: typeof globalThis.fetch;
  /**
   * The pause between players, `CAPSULE_CONFIG.sweepPacingMs` by default. Injectable ONLY so a
   * test that asserts the budget geometry over ten players does not sleep for fifty real seconds;
   * production never sets it. `reservedMsPerPlayer` deliberately keeps reading the config rather
   * than this, because the reserve is a statement about what a player costs in production, and a
   * test that shortened the reserve along with the sleep would no longer be testing the geometry
   * it claims to.
   */
  readonly pacingMs?: number;
}

/**
 * WHAT THE SWEEP RESERVES FOR ONE MORE PLAYER — the pacing pause plus ONE gateway round at the
 * gateway's own timeout (5s + 20s = 25s).
 *
 * IT IS THE REALISTIC RESERVE, NOT THE ABSOLUTE WORST CASE (review, blocker). The first version
 * reserved every retry of every one of the three calls (125s) against a window that is at most the
 * TICK budget (`JOBS_CONFIG.vercelTickBudgetMsDefault` is 50s, and `tick-handler.ts` caps even a
 * raised `JOBS_TICK_BUDGET_MS` at 280s). A reserve larger than the whole window fires on the first
 * iteration every time: nothing is ever written, the repetition check never runs, and the
 * zero-progress continuation dies on its own idempotency key. A guard that can never pass is worse
 * than no guard, because it looks like one.
 *
 * THE RUNNER'S OWN CUT IS THE BACKSTOP for the player who overruns this reserve. That is safe here
 * and nowhere else in this job: every player is committed as he is written (`upsertCapsule`
 * inside the loop), so an attempt killed mid-player loses that one player's gateway spend and
 * nothing else, and the next tick finds him still eligible.
 */
function reservedMsPerPlayer(): number {
  return CAPSULE_CONFIG.sweepPacingMs + CAPSULE_CONFIG.gateway.timeoutMs;
}

export async function runCapsuleSweepStep(
  db: Db,
  clock: Clock,
  deps: CapsuleSweepDeps,
  payload: CapsuleSweepPayload,
  deadlineAt?: Date,
): Promise<StepOutcome> {
  const asOf = new Date(clock.now());
  const pass = await collectBoardFacts(db, asOf);
  const facts = pass.facts;
  // THE PRECOMPUTED PEEK ROWS (peek-facts design §3.2) ride on the pass that just ran, before any
  // gateway call: a throttled or slow capsule generation must not be what decides whether a peek
  // opens fast, and the facts are already in hand either way.
  const peekFacts = await writeRefresh(db, pass);
  const stored = await getStoredCapsulesFor(db, facts.map((f) => f.identity.id));
  const eligible = facts.filter((f) => needsGeneration(f, stored.get(f.identity.id)));
  const budget = payload.budget ?? CAPSULE_CONFIG.sweepGenerationBudget;
  const toProcess = eligible.slice(0, budget);
  // THE STOCK-SENTENCE AVOID LIST (dossier-voice round §3.5) — computed from what the board is
  // ALREADY saying, before a word of this run is written, and quoted verbatim into every narrative
  // prompt this run makes. The same check runs again at the end over the updated board and queues
  // whoever is still repeating, so a flagged sentence is named in the prompt of exactly the run
  // that rewrites it.
  const avoid = sentencesToAvoid(stockSentences([...stored.values()]));

  let llmCount = 0;
  let templateCount = 0;
  let totalCostUsd = 0;
  let slotsWritten = 0;
  let slotsRejected = 0;
  const detail: string[] = [];

  const processed: string[] = [];
  let stoppedForBudget = false;
  let first = true;
  for (const one of toProcess) {
    // ROOM FOR ONE MORE? (review C1) — the runner will cut this attempt off at `deadlineAt`, so
    // the sweep stops itself one player early and hands the rest to a continuation. With no
    // deadline (the local runner, a test, an operator's own call) it processes the whole batch.
    if (deadlineAt !== undefined && new Date(clock.now()).getTime() + reservedMsPerPlayer() > deadlineAt.getTime()) {
      stoppedForBudget = true;
      break;
    }
    // Paced, not burst: see CAPSULE_CONFIG.sweepPacingMs. The pause sits BEFORE each player
    // after the first so a one-player run pays nothing.
    const pacingMs = deps.pacingMs ?? CAPSULE_CONFIG.sweepPacingMs;
    if (!first && pacingMs > 0) await new Promise((resolve) => setTimeout(resolve, pacingMs));
    first = false;
    const result = await generateCapsule(one, { apiKey: deps.apiKey, fetch: deps.fetch }, avoid);
    // Persisted per player as it goes, which is what makes a stop safe: a continuation re-reads
    // the stored rows and finds this player no longer eligible.
    await upsertCapsule(db, one.identity.id, one.factsHash, result);
    processed.push(one.identity.id);
    const cost = (result.compact.usage?.costUsd ?? 0) + (result.full.usage?.costUsd ?? 0) + (result.narrative.usage?.costUsd ?? 0);
    totalCostUsd += cost;
    slotsWritten += Object.keys(result.narrative.slots).length;
    slotsRejected += result.narrative.rejected.length;
    if (result.narrative.failure !== null) detail.push(`${one.identity.name}: narrative failed, ${result.narrative.failure}`);
    for (const rejection of result.narrative.rejected) detail.push(`${one.identity.name}: narrative slot rejected, ${rejection}`);
    if (result.source === "llm") {
      llmCount += 1;
      detail.push(`${one.identity.name}: llm, $${cost.toFixed(6)}`);
    } else {
      templateCount += 1;
      // Labeled by REASON (sweep resilience, color v2, Task 4) — "throttled" (the gateway never
      // gave either size a usable response, even after write.ts's own 429 backoff) reads as a
      // wholly different operational condition from "failed validation" (the gateway talked, the
      // model kept writing something the validator rejected), and an operator scanning a run's own
      // detail lines needs to tell the two apart at a glance.
      detail.push(`${one.identity.name}: ${describeCapsuleFallback(result.compact, result.full)}`);
    }
  }

  // THE EVENT (peek document design §3.4, row two): a written capsule is a changed document input,
  // for every scoring hash in use. Only the players this run actually wrote a capsule for are named.
  // The reason stamp is this pass's own instant, so a retried tick that reaches here twice with the
  // same clock coalesces into one build rather than two.
  if (processed.length > 0) {
    await enqueuePeekDocumentRebuildsQuietly(db, clock, {
      playerIds: processed,
      reason: `capsule:${asOf.toISOString()}`,
    });
  }

  // THE CONTINUATION (review C1) — tonight's cap minus what this run actually wrote, enqueued to
  // run immediately so the next tick claims it. Only when the budget stopped us AND there is work
  // and budget left, so a run that simply finished never chains.
  const budgetLeft = budget - processed.length;
  const continuationOf = payload.continuationOf ?? asOf.toISOString();
  // A RUN THAT WROTE NOTHING NEVER CHAINS (review, blocker). A continuation from a zero-progress
  // run would carry the identical budget and the identical key, so it would either dedupe into
  // nothing or spin forever, and either way the night would look busy and write no capsules. The
  // condition that causes it is a budget geometry problem an operator can fix in one environment
  // variable, so it is said out loud in the summary rather than left to be inferred from a board
  // that never changes.
  const wroteNothingInTime = stoppedForBudget && processed.length === 0;
  const willContinue = stoppedForBudget && processed.length > 0 && budgetLeft > 0 && eligible.length > processed.length;
  if (wroteNothingInTime) {
    detail.push(
      `budget: this attempt had less than the ${reservedMsPerPlayer() / 1000}s one player needs, so nothing was written. ` +
        `The tick budget (JOBS_TICK_BUDGET_MS, default ${JOBS_CONFIG.vercelTickBudgetMsDefault / 1000}s) is what caps an attempt, never this job's own timeout.`,
    );
  }
  if (willContinue) {
    await enqueueJob(db, clock, {
      name: CAPSULE_SWEEP_JOB_NAME,
      idempotencyKey: `capsule-sweep-continue@${continuationOf}#${budgetLeft}`,
      payload: { budget: budgetLeft, continuationOf },
      maxAttempts: 2,
      runAt: new Date(clock.now()),
    });
  }

  // THE REPETITION CHECK, over the board as it now stands, and ONLY on the run that finished the
  // night's work: it is a question about the whole board, and a half-swept board would flag
  // sentences the continuation is about to rewrite anyway. Every player still saying a sentence
  // more than `repetition.maxShare` of the board says has his cache key stamped stale, which is
  // the one condition `needsGeneration` above already treats as "write this player again".
  let stockFound = 0;
  let queued = 0;
  if (!willContinue) {
    const afterRun = await getStoredCapsulesFor(db, facts.map((f) => f.identity.id));
    const stock = stockSentences([...afterRun.values()]);
    stockFound = stock.length;
    queued = await queueCapsuleRegeneration(db, playersSayingStock(stock));
    for (const finding of stock.slice(0, CAPSULE_CONFIG.repetition.maxQuotedSentences)) {
      detail.push(`stock sentence on ${finding.playerIds.length} players (${(finding.share * 100).toFixed(1)}%): "${finding.example}"`);
    }
  }

  const remaining = eligible.length - processed.length;
  const summary =
    `capsule-sweep: ${facts.length} board players, ${eligible.length} needed a fresh generation, ` +
    `${processed.length} processed (${llmCount} llm, ${templateCount} template, $${totalCostUsd.toFixed(6)} spent)` +
    (remaining > 0 ? `, ${remaining} left for the next sweep` : "") +
    (willContinue ? `, continuing this tick's remainder in a follow-up run of ${budgetLeft}` : "") +
    (wroteNothingInTime ? ", WROTE NOTHING: the tick budget was too small for one player, see the detail line" : "") +
    `. Peek facts: ${peekFacts.players} rows built, ${peekFacts.changed} changed, ${peekFacts.withTouchesRank} with a touches rank` +
    `. Narrative: ${slotsWritten} slots written, ${slotsRejected} rejected` +
    (willContinue ? ", repetition check deferred to the run that finishes the batch" : `, ${stockFound} stock sentence(s) found, ${queued} player(s) queued for regeneration`);

  return { summary, detail };
}

export const capsuleSweepJob: AnyJobDefinition = defineJob<CapsuleSweepPayload>({
  name: CAPSULE_SWEEP_JOB_NAME,
  maxAttempts: 2,
  // Generous: up to `sweepGenerationBudget` players, each up to two gateway calls at up to two
  // attempts (one regeneration) per size, each bounded by the gateway's own `timeoutMs` and one
  // retry. Comfortably below a typical serverless ceiling even at the rare worst case.
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
