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
// carrying the rest of tonight's budget. `CAPSULE_CONFIG.sweepGenerationBudget` is the per-night
// ceiling, sized to cover every eligible player: the continuation's payload is what is left of it,
// never a fresh budget.
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
import type { JsonObject } from "@/domain/json";
import type { Clock } from "@/domain/timing";
import { CAPSULE_CONFIG } from "@/capsules/config";
import { collectBoardFacts } from "@/capsules/collect";
import { describeCapsuleFallback, generateCapsule } from "@/capsules/generate";
import { writeRefresh } from "@/capsules/peek-facts";
import type { WornPhrases } from "@/capsules/prompt";
import { playersSayingStock, sentencesToAvoid, stockSentences } from "@/capsules/repetition";
import { measureSameness, phrasesToAvoid, playersToRegenerateForSameness, samenessOverThreshold, type SamenessRow } from "@/capsules/sameness";
import { getStoredCapsulesFor, queueCapsuleRegeneration, RETRY_FIRST_FACTS_HASH, upsertCapsule, type StoredPlayerCapsule } from "@/capsules/store";
import type { PlayerFacts } from "@/capsules/facts";
import { BOARD_MEMO_GROUP, invalidateTtlMemoGroup } from "@/lib/cache/ttl-memo";
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

/**
 * THE ORDER OF THE RUN (overruns round, 2026-09-08): players demoted from a written read on a
 * previous run (`RETRY_FIRST_FACTS_HASH`) first, then the board order the pass came in. A
 * continuation is a run too, so a player demoted in one tick is retried in the next.
 */
function retryFirstThenBoardOrder(eligible: readonly PlayerFacts[], stored: ReadonlyMap<string, StoredPlayerCapsule>): readonly PlayerFacts[] {
  const demoted = (facts: PlayerFacts): boolean => stored.get(facts.identity.id)?.factsHash === RETRY_FIRST_FACTS_HASH;
  return [...eligible.filter(demoted), ...eligible.filter((facts) => !demoted(facts))];
}

/**
 * A WRITTEN PLAYER IS NOT DEMOTED SILENTLY (overruns round, 2026-09-08). When a player whose stored
 * read was written falls to the template, his old read cannot be kept (his facts moved, or the
 * repetition check queued him), but the demotion is said in his detail line and his row is stamped
 * to go first next run. The hash the row is written under is the stamp in that case, the real
 * hash otherwise.
 */
function demotedFromWritten(stored: StoredPlayerCapsule | undefined, source: "llm" | "template"): boolean {
  return stored?.source === "llm" && source === "template";
}

/** The stored board as the sameness measure reads it, each row carrying its player's name so his
 *  opener can be masked (`sameness.ts`). A stored row with no board player behind it is skipped:
 *  the measure is over the board the sweep is writing. */
function samenessRowsOf(stored: ReadonlyMap<string, StoredPlayerCapsule>, facts: readonly PlayerFacts[]): readonly SamenessRow[] {
  return facts.flatMap((one) => {
    const row = stored.get(one.identity.id);
    if (row === undefined) return [];
    return [{ playerId: row.playerId, name: one.identity.name, bodyCompact: row.bodyCompact, bodyFull: row.bodyFull, source: row.source, narrative: row.narrative }];
  });
}

/** What the board is already saying too often, quoted into every prompt this run makes: the whole
 *  stock sentences (`repetition.ts`) and the flagged stems and openers (`sameness.ts`). */
function wornPhrasesOf(stored: ReadonlyMap<string, StoredPlayerCapsule>, facts: readonly PlayerFacts[]): WornPhrases {
  return {
    sentences: sentencesToAvoid(stockSentences([...stored.values()])),
    phrases: phrasesToAvoid(measureSameness(samenessRowsOf(stored, facts))),
  };
}

/**
 * THE REPETITION CHECK, over the board as it now stands: the whole-sentence check and the sameness
 * measure together. Every player still saying a stock sentence, opening in a flagged family,
 * carrying a flagged refrain, or touring the sheet while touring is over its line has his cache
 * key stamped stale, which is the one condition `needsGeneration` already treats as "write this
 * player again". Returns the summary counts and the detail lines an operator reads.
 */
async function checkRepetition(db: Db, facts: readonly PlayerFacts[]): Promise<{ readonly stockFound: number; readonly samenessFlags: number; readonly queued: number; readonly detail: readonly string[] }> {
  const afterRun = await getStoredCapsulesFor(db, facts.map((f) => f.identity.id));
  const stock = stockSentences([...afterRun.values()]);
  const report = measureSameness(samenessRowsOf(afterRun, facts));
  const over = samenessOverThreshold(report);
  const queued = await queueCapsuleRegeneration(db, [...new Set([...playersSayingStock(stock), ...playersToRegenerateForSameness(report)])]);
  const percent = (share: number): string => `${(share * 100).toFixed(1)}%`;
  const detail = [
    ...stock.slice(0, CAPSULE_CONFIG.repetition.maxQuotedSentences).map((finding) => `stock sentence on ${finding.playerIds.length} players (${percent(finding.share)}): "${finding.example}"`),
    ...over.openers.map((finding) => `opener family on ${finding.playerIds.length} players (${percent(finding.share)}): "${finding.example}"`),
    ...over.refrains.map((finding) => `refrain on ${finding.playerIds.length} players (${percent(finding.share)}): "${finding.key}"`),
    ...(over.sheetTouring ? [`sheet-touring on ${report.sheetTouring.playerIds.length} players (${percent(report.sheetTouring.share)})`] : []),
  ];
  return { stockFound: stock.length, samenessFlags: over.openers.length + over.refrains.length + (over.sheetTouring ? 1 : 0), queued, detail };
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
 * WHAT THE SWEEP RESERVES FOR ONE MORE PLAYER — the pacing pause, every call of the player's own
 * ceiling (`CAPSULE_CONFIG.maxGatewayCallsPerPlayer`, four, overruns round 2026-09-08) at the
 * gateway's own spacing (`write.ts`'s limiter), plus one gateway timeout for the slowest of them:
 * 0s + 4 x 5s + 20s = 40s. Most players are one call, but the reserve is a statement about what a
 * player CAN cost, and it is kept honest against the tick: it fits the default 50s tick
 * (`JOBS_CONFIG.vercelTickBudgetMsDefault`) once, and a raised `JOBS_TICK_BUDGET_MS` (capped at
 * 280s by `tick-handler.ts`) seven times. `capsule-sweep-job.test.ts` pins both.
 *
 * IT IS THE REALISTIC RESERVE, NOT THE ABSOLUTE WORST CASE (review, blocker). The first version
 * reserved every retry of every call (125s) against a window that is at most the tick budget. A
 * reserve larger than the whole window fires on the first iteration every time: nothing is ever
 * written, the repetition check never runs, and the zero-progress continuation dies on its own
 * idempotency key. A guard that can never pass is worse than no guard, because it looks like one.
 *
 * THE RUNNER'S OWN CUT IS THE BACKSTOP for the player who overruns this reserve. That is safe here
 * and nowhere else in this job: every player is committed as he is written (`upsertCapsule`
 * inside the loop), so an attempt killed mid-player loses that one player's gateway spend and
 * nothing else, and the next tick finds him still eligible.
 */
export function reservedMsPerPlayer(): number {
  return CAPSULE_CONFIG.sweepPacingMs + CAPSULE_CONFIG.maxGatewayCallsPerPlayer * CAPSULE_CONFIG.gateway.minCallSpacingMs + CAPSULE_CONFIG.gateway.timeoutMs;
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
  const eligible = retryFirstThenBoardOrder(
    facts.filter((f) => needsGeneration(f, stored.get(f.identity.id))),
    stored,
  );
  const budget = payload.budget ?? CAPSULE_CONFIG.sweepGenerationBudget;
  const toProcess = eligible.slice(0, budget);
  // THE WORN-LANGUAGE LIST (dossier-voice round §3.5, widened in the refrains round) — computed
  // from what the board is ALREADY saying, before a word of this run is written, and quoted into
  // every prompt this run makes. The same checks run again at the end over the updated board and
  // queue whoever is still repeating, so a flagged sentence or stem is named in the prompt of
  // exactly the run that rewrites it.
  const worn = wornPhrasesOf(stored, facts);

  let llmCount = 0;
  let templateCount = 0;
  let demotedCount = 0;
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
    const result = await generateCapsule(one, { apiKey: deps.apiKey, fetch: deps.fetch }, worn);
    const demoted = demotedFromWritten(stored.get(one.identity.id), result.source);
    // Persisted per player as it goes, which is what makes a stop safe: a continuation re-reads
    // the stored rows and finds this player no longer eligible (or, demoted, first in line).
    await upsertCapsule(db, one.identity.id, demoted ? RETRY_FIRST_FACTS_HASH : one.factsHash, result);
    processed.push(one.identity.id);
    const cost = result.usage?.costUsd ?? 0;
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
      // detail lines needs to tell the two apart at a glance. A demotion from a written read is
      // named on the same line (see `demotedFromWritten`).
      if (demoted) demotedCount += 1;
      detail.push(`${one.identity.name}: ${describeCapsuleFallback(result.compact, result.full)}${demoted ? ", kept nothing, was written" : ""}`);
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
  // sentences the continuation is about to rewrite anyway. See `checkRepetition`.
  const repetition = willContinue ? null : await checkRepetition(db, facts);
  if (repetition !== null) detail.push(...repetition.detail);

  // The sweep is the nightly pass that regenerates what the board's readers serve (the reasons,
  // the peek facts every board row's dossier reads), so every memo built on the served board is
  // dropped on this instance once the run has written (site search fix round, 2026-09-08). The
  // board's own persist (`writePreseasonBoard`) does the same; between them, a fresh board
  // reaches the search index and the team pages on the next request rather than within the hour.
  invalidateTtlMemoGroup(BOARD_MEMO_GROUP);

  const remaining = eligible.length - processed.length;
  const summary =
    `capsule-sweep: ${facts.length} board players, ${eligible.length} needed a fresh generation, ` +
    `${processed.length} processed (${llmCount} llm, ${templateCount} template, $${totalCostUsd.toFixed(6)} spent)` +
    (demotedCount > 0 ? `, ${demotedCount} written player(s) fell to the template and go first next run` : "") +
    (remaining > 0 ? `, ${remaining} left for the next sweep` : "") +
    (willContinue ? `, continuing this tick's remainder in a follow-up run of ${budgetLeft}` : "") +
    (wroteNothingInTime ? ", WROTE NOTHING: the tick budget was too small for one player, see the detail line" : "") +
    `. Peek facts: ${peekFacts.players} rows built, ${peekFacts.changed} changed, ${peekFacts.withTouchesRank} with a touches rank` +
    `. Narrative: ${slotsWritten} slots written, ${slotsRejected} rejected` +
    (repetition === null
      ? ", repetition check deferred to the run that finishes the batch"
      : `, ${repetition.stockFound} stock sentence(s) found, ${repetition.samenessFlags} sameness flag(s), ${repetition.queued} player(s) queued for regeneration`);

  return { summary, detail };
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
