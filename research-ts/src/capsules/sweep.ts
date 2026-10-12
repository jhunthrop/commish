// THE PLAYER CAPSULE SWEEP (spec §9 AMENDED 2026-09-04, Task 3) — recomputes every board-relevant
// player's facts and regenerates a capsule wherever the facts hash has moved, the row is missing,
// or the existing row is still template-sourced (a 429'd or facts-outrun capsule keeps retrying
// on every sweep until the gateway lets it through, rather than freezing on its own template hash
// forever). The research nightly run calls it with no deadline; the league app's job system wraps
// it (`src/jobs/defs/capsule-sweep-job.ts`) and owns everything that is about its own queue: the
// continuation, the peek rows and the memo drop (the prep site carve-out, 2026-10-12).
//
// THE HOOK FOR THE PASS (peek-facts design §3.2, 2026-09-07). The pass this sweep runs for the whole
// board is exactly the pass a precomputed peek row needs, so a caller that writes peek rows receives
// it through `CapsuleSweepHooks.afterFacts` rather than running a second heavy pass of its own.
//
// IT CAN RUN ACROSS TICKS, NOT INSIDE ONE (review C1, 2026-09-07). The runner caps a claimed job at
// whatever is left of the TICK's budget, never at the job's own `timeoutMs`, so a batch of 35 players at 5s pacing plus 7-20s of generation each
// could never finish inside one attempt: the step was being cut off mid-batch every night and the
// repetition check at the end never ran in production at all. The sweep now reads a
// `deadlineAt`, stops BEFORE the player that would cross it, and reports the continuation its caller
// enqueues, carrying the rest of tonight's budget. `CAPSULE_CONFIG.sweepGenerationBudget` is the per-night
// ceiling, sized to cover every eligible player: the continuation's payload is what is left of it,
// never a fresh budget.
//
// THE REPETITION CHECK RUNS ONLY ON THE RUN THAT FINISHES THE NIGHT'S WORK, because it is a
// question about the whole board and a half-swept board would flag sentences the second half is
// about to rewrite anyway.
//
// TERMINAL VS RETRYABLE: `generate.ts` never throws (the template is the permanent floor), so
// nothing inside a single player's own attempt can fail the sweep — a gateway outage degrades every
// eligible player to template this run and the summary says so plainly. What CAN throw is the
// database work around it (`collectBoardFacts`, `getStoredCapsulesFor`, `upsertCapsule`), and
// that is ordinary retryable weather like every other database step.
import type { Db } from "@research-ts/db/client";
import type { Clock } from "@research-ts/domain/timing";
import { CAPSULE_CONFIG } from "./config";
import { collectBoardFacts, type BoardFactsPass } from "./collect";
import { describeCapsuleFallback, generateCapsule } from "./generate";
import type { WornPhrases } from "./prompt";
import { playersSayingStock, sentencesToAvoid, stockSentences } from "./repetition";
import { measureSameness, phrasesToAvoid, playersToRegenerateForSameness, samenessOverThreshold, type SamenessRow } from "./sameness";
import { getStoredCapsulesFor, queueCapsuleRegeneration, RETRY_FIRST_FACTS_HASH, upsertCapsule, type StoredPlayerCapsule } from "./store";
import type { PlayerFacts } from "./facts";

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
 * player CAN cost, and it is kept honest against the league app's tick: it fits the default 50s
 * tick once, and a raised `JOBS_TICK_BUDGET_MS` (capped at 280s) seven times.
 * `src/jobs/defs/capsule-sweep-job.test.ts` pins both.
 *
 * IT IS THE REALISTIC RESERVE, NOT THE ABSOLUTE WORST CASE (review, blocker). The first version
 * reserved every retry of every call (125s) against a window that is at most the tick budget. A
 * reserve larger than the whole window fires on the first iteration every time: nothing is ever
 * written, the repetition check never runs, and the zero-progress continuation dies on its own
 * idempotency key. A guard that can never pass is worse than no guard, because it looks like one.
 *
 * THE RUNNER'S OWN CUT IS THE BACKSTOP for the player who overruns this reserve. That is safe here
 * and nowhere else in this sweep: every player is committed as he is written (`upsertCapsule`
 * inside the loop), so an attempt killed mid-player loses that one player's gateway spend and
 * nothing else, and the next tick finds him still eligible.
 */
export function reservedMsPerPlayer(): number {
  return CAPSULE_CONFIG.sweepPacingMs + CAPSULE_CONFIG.maxGatewayCallsPerPlayer * CAPSULE_CONFIG.gateway.minCallSpacingMs + CAPSULE_CONFIG.gateway.timeoutMs;
}

export interface CapsuleSweepOptions {
  /** Overrides `CAPSULE_CONFIG.sweepGenerationBudget` for this run only: an operator's wider
   *  rerun, or a continuation's own remaining share of tonight's cap. */
  readonly budget?: number;
  /** The instant past which no further player is started (`reservedMsPerPlayer` ahead of it). Absent
   *  means the whole batch: the nightly run, a script, a test. */
  readonly deadlineAt?: Date;
}

export interface CapsuleSweepHooks {
  /**
   * Runs on the board facts pass before any gateway call, so a throttled or slow generation never
   * decides whether its output lands. The league app writes its precomputed peek rows here (peek
   * facts design §3.2). Returns the lines the caller wants in the summary.
   */
  readonly afterFacts?: (pass: BoardFactsPass) => Promise<string>;
}

/** What one sweep did, in numbers a caller composes its own summary from. */
export interface CapsuleSweepReport {
  readonly asOf: Date;
  readonly boardPlayers: number;
  readonly eligible: number;
  /** Product player ids written this run, in the order they were written. */
  readonly processed: readonly string[];
  readonly llm: number;
  readonly template: number;
  readonly demoted: number;
  readonly costUsd: number;
  readonly slotsWritten: number;
  readonly slotsRejected: number;
  /** The rest of tonight's budget when the deadline stopped the sweep with work and budget left;
   *  null when the sweep finished or cannot usefully continue. The caller enqueues it. */
  readonly continuation: { readonly budgetLeft: number } | null;
  /** The deadline stopped the sweep before it wrote a single player. */
  readonly wroteNothingInTime: boolean;
  /** Null when deferred to the run that finishes the night (a continuation is pending). */
  readonly repetition: { readonly stockFound: number; readonly samenessFlags: number; readonly queued: number } | null;
  readonly afterFactsSummary: string | null;
  readonly detail: readonly string[];
}

interface GenerationTally {
  llm: number;
  template: number;
  demoted: number;
  costUsd: number;
  slotsWritten: number;
  slotsRejected: number;
}

/** One player's generation, written as it goes, which is what makes a stop safe: a continuation
 *  re-reads the stored rows and finds this player no longer eligible (or, demoted, first in line). */
async function writeOne(
  db: Db,
  one: PlayerFacts,
  stored: StoredPlayerCapsule | undefined,
  deps: CapsuleSweepDeps,
  worn: WornPhrases,
  tally: GenerationTally,
  detail: string[],
): Promise<void> {
  const result = await generateCapsule(one, { apiKey: deps.apiKey, fetch: deps.fetch }, worn);
  const demoted = demotedFromWritten(stored, result.source);
  await upsertCapsule(db, one.identity.id, demoted ? RETRY_FIRST_FACTS_HASH : one.factsHash, result);
  const cost = result.usage?.costUsd ?? 0;
  tally.costUsd += cost;
  tally.slotsWritten += Object.keys(result.narrative.slots).length;
  tally.slotsRejected += result.narrative.rejected.length;
  if (result.narrative.failure !== null) detail.push(`${one.identity.name}: narrative failed, ${result.narrative.failure}`);
  for (const rejection of result.narrative.rejected) detail.push(`${one.identity.name}: narrative slot rejected, ${rejection}`);
  if (result.source === "llm") {
    tally.llm += 1;
    detail.push(`${one.identity.name}: llm, $${cost.toFixed(6)}`);
    return;
  }
  tally.template += 1;
  // Labeled by REASON (sweep resilience, color v2, Task 4): "throttled" (the gateway never gave
  // either size a usable response, even after write.ts's own 429 backoff) is a different
  // operational condition from "failed validation" (the gateway talked, the model kept writing
  // something the validator rejected). A demotion from a written read is named on the same line.
  if (demoted) tally.demoted += 1;
  detail.push(`${one.identity.name}: ${describeCapsuleFallback(result.compact, result.full)}${demoted ? ", kept nothing, was written" : ""}`);
}

/**
 * THE SWEEP: the facts pass, the generation loop, and the repetition check over the board as it
 * then stands. Everything about a queue (the continuation job, a peek rebuild, a memo drop) is the
 * caller's, from the returned report.
 */
export async function sweepCapsules(
  db: Db,
  clock: Clock,
  deps: CapsuleSweepDeps,
  options: CapsuleSweepOptions = {},
  hooks: CapsuleSweepHooks = {},
): Promise<CapsuleSweepReport> {
  const asOf = new Date(clock.now());
  const pass = await collectBoardFacts(db, asOf);
  const facts = pass.facts;
  const afterFactsSummary = hooks.afterFacts === undefined ? null : await hooks.afterFacts(pass);
  const stored = await getStoredCapsulesFor(db, facts.map((f) => f.identity.id));
  const eligible = retryFirstThenBoardOrder(
    facts.filter((f) => needsGeneration(f, stored.get(f.identity.id))),
    stored,
  );
  const budget = options.budget ?? CAPSULE_CONFIG.sweepGenerationBudget;
  // THE WORN-LANGUAGE LIST (dossier-voice round §3.5, widened in the refrains round): computed from
  // what the board is ALREADY saying, before a word of this run is written, and quoted into every
  // prompt this run makes. The same checks run again at the end over the updated board.
  const worn = wornPhrasesOf(stored, facts);
  const tally: GenerationTally = { llm: 0, template: 0, demoted: 0, costUsd: 0, slotsWritten: 0, slotsRejected: 0 };
  const detail: string[] = [];
  const processed: string[] = [];
  let stoppedForBudget = false;
  const pacingMs = deps.pacingMs ?? CAPSULE_CONFIG.sweepPacingMs;
  for (const one of eligible.slice(0, budget)) {
    // ROOM FOR ONE MORE? (review C1): stop one player early and hand the rest to a continuation.
    if (options.deadlineAt !== undefined && new Date(clock.now()).getTime() + reservedMsPerPlayer() > options.deadlineAt.getTime()) {
      stoppedForBudget = true;
      break;
    }
    // Paced, not burst (CAPSULE_CONFIG.sweepPacingMs). The pause sits BEFORE each player after the
    // first so a one-player run pays nothing.
    if (processed.length > 0 && pacingMs > 0) await new Promise((resolve) => setTimeout(resolve, pacingMs));
    await writeOne(db, one, stored.get(one.identity.id), deps, worn, tally, detail);
    processed.push(one.identity.id);
  }
  // A RUN THAT WROTE NOTHING NEVER CHAINS (review, blocker): a continuation from a zero-progress run
  // would carry the identical budget and key, and either dedupe into nothing or spin forever.
  const budgetLeft = budget - processed.length;
  const wroteNothingInTime = stoppedForBudget && processed.length === 0;
  const continues = stoppedForBudget && processed.length > 0 && budgetLeft > 0 && eligible.length > processed.length;
  // THE REPETITION CHECK runs ONLY on the run that finishes the night's work: a half-swept board
  // would flag sentences the continuation is about to rewrite anyway.
  const repetition = continues ? null : await checkRepetition(db, facts);
  if (repetition !== null) detail.push(...repetition.detail);
  return {
    asOf,
    boardPlayers: facts.length,
    eligible: eligible.length,
    processed,
    ...tally,
    continuation: continues ? { budgetLeft } : null,
    wroteNothingInTime,
    repetition: repetition === null ? null : { stockFound: repetition.stockFound, samenessFlags: repetition.samenessFlags, queued: repetition.queued },
    afterFactsSummary,
    detail,
  };
}

/** The one-paragraph account of a sweep an operator reads. */
export function describeSweep(report: CapsuleSweepReport): string {
  const remaining = report.eligible - report.processed.length;
  return (
    `capsule-sweep: ${report.boardPlayers} board players, ${report.eligible} needed a fresh generation, ` +
    `${report.processed.length} processed (${report.llm} llm, ${report.template} template, $${report.costUsd.toFixed(6)} spent)` +
    (report.demoted > 0 ? `, ${report.demoted} written player(s) fell to the template and go first next run` : "") +
    (remaining > 0 ? `, ${remaining} left for the next sweep` : "") +
    (report.continuation !== null ? `, continuing this tick's remainder in a follow-up run of ${report.continuation.budgetLeft}` : "") +
    (report.wroteNothingInTime ? ", WROTE NOTHING: the tick budget was too small for one player, see the detail line" : "") +
    (report.afterFactsSummary === null ? "" : `. ${report.afterFactsSummary}`) +
    `. Narrative: ${report.slotsWritten} slots written, ${report.slotsRejected} rejected` +
    (report.repetition === null
      ? ", repetition check deferred to the run that finishes the batch"
      : `, ${report.repetition.stockFound} stock sentence(s) found, ${report.repetition.samenessFlags} sameness flag(s), ${report.repetition.queued} player(s) queued for regeneration`)
  );
}
