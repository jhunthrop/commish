import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import type { Db, DbTx } from "@research/db/client";
import { integrityFlags, tradeProposals } from "@/db/schema";
import type { Clock } from "@research/domain/timing";
import { assembleAdvisorContext, valuePlayers, type AdvisorTeamContext } from "@/ai-advisor/context";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import type { ResolutionDecision, TradeFairnessBasis } from "@/integrity/flags";
import { assetPlayerIds } from "@/trades/assets";
import { crossesFairnessThreshold, fairnessGap, tradeBalance, type TradeBalance, type ValuedPlayer } from "@/trades/fairness";
import { getAuditLogger, type AuditLogger } from "./audit-logger";
// Imported from `./raise-flag` DIRECTLY, never from `./flags` — `flags.ts` also wires
// `resolveFlag`'s `trade_reversed` branch to `reverseTradeInTx` (`@/league-service/trade-
// reversal`), and this detector's own closure must never reach a trade-mutating module
// (`src/integrity/flag-only.test.ts`'s own contract). `raise-flag.ts` is the self-contained slice
// that keeps that true; `flags.ts` re-exports the identical names for every OTHER caller.
import { raiseFlag, type IntegrityFlag } from "./raise-flag";

const systemClock: Clock = { now: () => new Date().toISOString() };

export interface EvaluateTradeInput {
  readonly leagueId: string;
  /** The week this trade is valued at — `acceptTrade`'s own SERVER-DERIVED current week (final
   *  review, CRITICAL 1), the same value it stamps onto `trade_proposals.weekNumber` in the same
   *  transaction. Read-only here: this function moves nothing, so there is no "as of when"
   *  question beyond which week's roster/scoring context to price the two sides against. */
  readonly weekNumber: number;
  readonly proposerTeamId: string;
  readonly counterpartyTeamId: string;
  readonly proposerAssetIds: readonly string[];
  readonly counterpartyAssetIds: readonly string[];
  /**
   * TEST SEAM ONLY. Defaults to `INTEGRITY_CONFIG.trade.autoHoldThreshold` (`null`) — production
   * acceptTrade never supplies this. It exists so the `hold` branch is covered by a test that
   * passes a different number rather than a test that edits the config, the same shape
   * `crossesFairnessThreshold`'s own `threshold` parameter and Plan B's ip-weight test both use.
   */
  readonly autoHoldThreshold?: number | null;
}

export interface TradeFairnessEvaluation {
  readonly balance: TradeBalance;
  readonly gap: number;
  /** At or past `INTEGRITY_CONFIG.trade.fairnessFlagThreshold`. Task 6 acts on it AFTER commit. */
  readonly flagWorthy: boolean;
  /** At or past `INTEGRITY_CONFIG.trade.autoHoldThreshold`. `false` whenever that config is
   *  `null` (a test seam only — production ships `35`). `acceptTrade` acts on it, INSIDE the
   *  accept transaction, by not executing — see that function's own docblock for the second gate
   *  (`enforcementAppliesTo`) that decides whether a crossed threshold actually holds anything. */
  readonly hold: boolean;
  /**
   * Both sides, valued, from the SAME read `balance` came from — the rosters a moment before the
   * trade moved them. Task 6's after-commit `raiseTradeFairnessFlag` rides these straight into the
   * flag's own evidence rather than re-deriving them post-commit (which, this soon after, would
   * still be free — but re-deriving twice from the identical read is a second opinion nobody
   * asked for, the same "one function, one verdict" discipline `tradeBalance`'s own docblock
   * states). `sweepUnflaggedTrades`, running long after rosters have moved on, re-derives its own
   * copy instead — see that function's own docblock.
   */
  readonly giving: readonly ValuedPlayer[];
  readonly receiving: readonly ValuedPlayer[];
}

/**
 * The fairness verdict for a trade that is ABOUT to execute, computed inside the accept
 * transaction (`acceptTrade`, `@/league-service/trades`) from the rosters as they stand a moment
 * before they move.
 *
 * WHY INSIDE. The spec's Step 3 evaluates a trade that has already completed; Step 5 has to
 * intercept one before it does, and a trade that already executed cannot be "held". The
 * resolution is that the SCORE is computed here, where both rosters are already locked and read
 * by `acceptTrade`'s own team locks, and the DECISION about what to do with it is a branch in
 * this function's own result. Plan D supplies a number for `INTEGRITY_CONFIG.trade
 * .autoHoldThreshold`; it does not reopen this transaction to add a code path.
 *
 * Plan D (Task 5) supplied the number: `INTEGRITY_CONFIG.trade.autoHoldThreshold` is `35`, so
 * `hold` is `true` for a trade whose gap reaches it — this function's own contract did not change
 * at all, only the config value a real caller now reads through it. `acceptTrade`
 * (`@/league-service/trades`) is the one production caller that acts on `hold`, and only when
 * `enforcementAppliesTo` also says the platform is this league's commissioner (a public,
 * platform-enforced league) — a private league's manager never has a trade held, however lopsided,
 * because the platform is never that league's commissioner. That second gate lives in
 * `acceptTrade` itself, not here: this function answers "how lopsided", never "whose business is
 * it".
 *
 * FLAG-ONLY, and provably so: this function returns a verdict and writes nothing.
 * `src/integrity/flag-only.test.ts` covers the directory it lives in.
 *
 * VALUES BOTH SIDES FROM THE ROSTER, NEVER FROM THE OFFER'S OWN RECORD: `assembleAdvisorContext`
 * (`@/ai-advisor/context`) reads `roster_slots` fresh, inside this same transaction, so a player
 * who has since left either roster is caught here rather than trusted from a stale plan — the
 * same "enforce at accept time" discipline `acceptTrade`'s own ownership re-check already keeps.
 *
 * GHOST PLAYERS REFUSE, RATHER THAN VALUE AT ZERO. `valuePlayers` silently DROPS an unknown id,
 * and `createTradeAnalyzer` (`@/ai-advisor/trade`) already catches that by comparing the valued
 * list's length against the id list it was given. This function makes the identical check — a
 * trade this function cannot see both sides of is a shape error, not a lopsided verdict, and a
 * silent zero would let a vanished player make an even trade look one-sided to a human who never
 * asked that question.
 */
export async function evaluateTradeBeforeExecute(tx: DbTx, input: EvaluateTradeInput): Promise<TradeFairnessEvaluation> {
  const [proposerContext, counterpartyContext] = await Promise.all([
    assembleAdvisorContext(tx, { leagueId: input.leagueId, teamId: input.proposerTeamId, weekNumber: input.weekNumber }),
    assembleAdvisorContext(tx, { leagueId: input.leagueId, teamId: input.counterpartyTeamId, weekNumber: input.weekNumber }),
  ]);
  if (proposerContext === null || counterpartyContext === null) {
    throw new Error(`evaluateTradeBeforeExecute: couldn't value this trade — a team no longer resolves in league ${input.leagueId}.`);
  }

  const giving = valuePlayers(proposerContext.me, input.proposerAssetIds);
  const receiving = valuePlayers(counterpartyContext.me, input.counterpartyAssetIds);
  if (giving.length !== input.proposerAssetIds.length || receiving.length !== input.counterpartyAssetIds.length) {
    throw new Error("evaluateTradeBeforeExecute: couldn't value this trade — a named player no longer resolves on either roster.");
  }

  const balance = tradeBalance(giving, receiving);
  const autoHoldThreshold = input.autoHoldThreshold === undefined ? INTEGRITY_CONFIG.trade.autoHoldThreshold : input.autoHoldThreshold;

  return {
    balance,
    gap: fairnessGap(balance),
    flagWorthy: crossesFairnessThreshold(balance, INTEGRITY_CONFIG.trade.fairnessFlagThreshold),
    hold: crossesFairnessThreshold(balance, autoHoldThreshold),
    giving,
    receiving,
  };
}

// ---------------------------------------------------------------------------------------------
// Task 6: the after-commit flag, and the sweep that re-derives what a dead process missed.
// ---------------------------------------------------------------------------------------------

export interface RaiseTradeFairnessInput {
  readonly tradeId: string;
  readonly leagueId: string;
  readonly balance: TradeBalance;
  readonly gap: number;
  /** The evidence's own copy — see `TradeFairnessEvaluation.giving`/`.receiving`'s docblock. */
  readonly giving: readonly ValuedPlayer[];
  readonly receiving: readonly ValuedPlayer[];
  /**
   * Task 6 fix round 1 (review MEDIUM 1). REQUIRED, not defaulted: `evidence` is written ONCE
   * and never rewritten, so a caller that forgot to say which of the two evaluations it is
   * passing would write a flag no later read can attribute — a compile error here is cheaper
   * than that gap. `trades.ts`'s after-commit call always passes `"accept_evaluation"`;
   * `sweepUnflaggedTrades` always passes `"sweep_rederivation"`. See `TradeFairnessBasis`'s own
   * docblock (`@/integrity/flags`) for what the two mean and why an operator needs to tell them
   * apart.
   */
  readonly basis: TradeFairnessBasis;
  readonly occurredAt: string;
  /**
   * TEST SEAM ONLY, mirroring `EvaluateTradeInput.autoHoldThreshold`'s own docblock. Defaults to
   * `INTEGRITY_CONFIG.trade.fairnessFlagThreshold` — production callers never supply this. It is
   * what makes the spec's exit criterion ("a config-only edit flips flagging outcomes with no
   * code change") a test that passes a different number rather than a test that rewrites a
   * `const` module.
   */
  readonly fairnessFlagThreshold?: number;
  readonly newId?: () => string;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
}

/**
 * Exported for `acceptTrade`'s own hold branch (`@/league-service/trades`, Plan D Task 5): the
 * `trade_hold` flag's evidence is the SAME shape a `trade_fairness` flag's is — both sides valued,
 * the balance, the gap, the threshold that raised it — computed from the SAME `TradeFairnessEvaluation`
 * `evaluateTradeBeforeExecute` already returned, so a held trade's evidence is read back from real
 * numbers rather than restated by a second copy of this function.
 */
export function evidenceFor(input: Pick<RaiseTradeFairnessInput, "balance" | "gap" | "giving" | "receiving" | "basis">, threshold: number) {
  return {
    verdict: input.balance.verdict,
    // Stored VERBATIM — the analyzer's own machine-readable reasons, never re-summarized.
    flags: input.balance.flags,
    givingValue: input.balance.givingValue,
    receivingValue: input.balance.receivingValue,
    gap: input.gap,
    threshold,
    // Task 6 fix round 1 (review MEDIUM 1): which of the two callers computed this evidence —
    // read back honestly, never re-derived, by `subjectFor`'s `valuationBasis`
    // (`@/integrity-service/flags`, `@/integrity/queue-view`'s `tradeFairnessBasisPhrase`).
    basis: input.basis,
    // The per-player breakdown `FlagSubjectView`'s trade arm reads at render time — written ONCE,
    // here, never re-derived on a later read (Plan B's own evidence discipline: `evidence` is
    // "what was true when it was raised", and a player's form has moved on by the time an
    // operator looks).
    giving: input.giving.map((player) => ({ playerId: player.playerId, name: player.name, position: player.position, averagePoints: player.averagePoints })),
    receiving: input.receiving.map((player) => ({ playerId: player.playerId, name: player.name, position: player.position, averagePoints: player.averagePoints })),
  };
}

/**
 * Raise a `trade_fairness` flag for a trade that has ALREADY executed.
 *
 * IT IS A SEPARATE TRANSACTION, AND THAT IS NOT A CONVENIENCE (ruling 22). `trade_accepted` is
 * league-scoped and `flag_raised` is platform-scoped (Plan B ruling 1: a record about a person
 * under review is not the league's business). Plan A's ruling 3 says a transaction appends to at
 * most one chain and `recordAll` throws on a batch that spans two, so writing this flag inside
 * the accept transaction is not a style choice that was rejected — it does not compile past the
 * first append and would deadlock past the second.
 *
 * THE CONSEQUENCE, STATED: a process that dies between the accept commit and this call leaves a
 * lopsided trade with no flag. The trade is correct and complete, the audit trail is complete,
 * and only the QUESTION is missing. So a failure here is logged, never surfaced to the manager
 * (who did nothing and can do nothing about it — `trades.ts`'s own call site swallows it the same
 * way `sweepQuietly` swallows a failed multi-account sweep), and `npm run trades:sweep` re-raises
 * every accepted trade over the threshold that has no flag — the same asymmetry, and the same
 * operator remedy, that Plan B's after-commit multi-account sweep already carries (ruling 11
 * there).
 *
 * `raiseFlag`'s open-subject unique index makes the re-run idempotent by construction: a second
 * raise for the same trade returns the existing flag and writes no second event. Below the
 * threshold, this writes nothing at all and returns `null` — the THRESHOLD DECISION lives here,
 * once, so every caller (the after-commit call and the sweep) gets the identical answer from the
 * identical check rather than each re-testing `crossesFairnessThreshold` on its own.
 */
export async function raiseTradeFairnessFlag(db: Db, input: RaiseTradeFairnessInput): Promise<IntegrityFlag | null> {
  const threshold = input.fairnessFlagThreshold ?? INTEGRITY_CONFIG.trade.fairnessFlagThreshold;
  if (!crossesFairnessThreshold(input.balance, threshold)) return null;

  const newId = input.newId ?? (() => crypto.randomUUID());
  return db.transaction((tx) =>
    raiseFlag(tx, {
      flagType: "trade_fairness",
      subjectId: input.tradeId,
      leagueId: input.leagueId,
      evidence: evidenceFor(input, threshold),
      raisedByUserId: null, // a system path, never a member accusing another — ruling 12
      occurredAt: input.occurredAt,
      newId,
      audit: input.audit ?? getAuditLogger(),
    }),
  );
}

/** One `trade_proposals` row this sweep still owes a look — the fields `reDeriveAcceptedTradeValue`
 *  needs, nothing more. */
interface UnflaggedAcceptedTrade {
  readonly id: string;
  readonly leagueId: string;
  readonly weekNumber: number;
  readonly proposerTeamId: string;
  readonly counterpartyTeamId: string;
  readonly proposerAssetIds: readonly string[];
  readonly counterpartyAssetIds: readonly string[];
}

/**
 * Every ACCEPTED trade whose fairness question NOTHING has answered yet — scoped to one league
 * when `leagueId` is supplied, every league otherwise.
 *
 * TWO dispositions disqualify a trade, and both count open OR resolved, never just open:
 *
 * 1. A `trade` flag — this detector's own `trade_fairness` verdict, already raised (by the
 *    after-commit call or an earlier sweep) and possibly already answered.
 * 2. A `held_trade` flag — the AUTO-HOLD's verdict, raised INSIDE the accept transaction by
 *    `holdTradeInTx` (`@/league-service/trades`) and answered by an operator pressing Release or
 *    Block. Final review F1: a released trade is stamped back to `status = "accepted"`
 *    (`trades.ts`, `releaseHeldTradeInTx`) and carries no `trade` flag, so without this it
 *    matched, and the sweep raised a fresh OPEN `trade_fairness` flag over a trade an operator had
 *    just explicitly approved — offering **Reverse this trade**, the inverse of the decision just
 *    made, with no trail of it (`trailFor`'s `trade` branch reads the LEAGUE chain, and the
 *    release's `flag_resolved` lives on the PLATFORM one).
 *
 * WHY A HOLD IS A FAIRNESS DISPOSITION AND NOT A DIFFERENT QUESTION. The two thresholds are
 * ordered on one axis and pinned that way (`fairnessFlagThreshold` 20 ≤ `autoHoldThreshold` 35,
 * `src/integrity/config.test.ts`), so every trade that held would also have flagged; and the hold
 * flag carries the IDENTICAL `evidenceFor` payload a fairness flag would have — same balance, same
 * gap, both sides valued. An operator answering a hold has answered this detector's question at a
 * STRICTER threshold, on the same evidence, before the rosters ever moved. Re-asking it is not a
 * second opinion, it is re-litigating a decision.
 *
 * The other two hold outcomes need no separate arm: a BLOCKED trade never executed and is stamped
 * `status = "blocked"`, so it never matched `status = 'accepted'` in the first place, and a
 * SUPERSEDED one is `status = "superseded"` for the same reason.
 *
 * `NOT EXISTS` rather than a `LEFT JOIN … IS NULL`: `integrity_flags` has no foreign key onto
 * `trade_proposals` (a flag's `subject_id` is plain text, matching every other subject type), so
 * this is a correlated subquery, not an index-backed join. Two of them rather than one that
 * ignores `subject_type`, because `subject_id` is plain text shared across every subject
 * vocabulary and a predicate that names neither type would silently widen the day some future
 * subject reuses an id shape. Bounded at `INTEGRITY_CONFIG.trade.sweepBatchSize` for the same "an
 * operator script that reads an unbounded set is a script nobody runs twice" reason that field's
 * own docblock states — and a disqualified trade costs no slot of that bound, because it is
 * excluded HERE rather than skipped after `reDeriveAcceptedTradeValue` has already paid for it.
 */
async function unflaggedAcceptedTrades(db: Db, leagueId: string | undefined, limit: number): Promise<readonly UnflaggedAcceptedTrade[]> {
  const noFlagOfSubjectType = (subjectType: "trade" | "held_trade") =>
    notExists(
      db
        .select({ one: sql`1` })
        .from(integrityFlags)
        .where(and(eq(integrityFlags.subjectType, subjectType), eq(integrityFlags.subjectId, tradeProposals.id))),
    );

  const rows = await db
    .select()
    .from(tradeProposals)
    .where(
      and(
        eq(tradeProposals.status, "accepted"),
        leagueId === undefined ? undefined : eq(tradeProposals.leagueId, leagueId),
        noFlagOfSubjectType("trade"),
        noFlagOfSubjectType("held_trade"),
      ),
    )
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    leagueId: row.leagueId,
    weekNumber: row.weekNumber,
    proposerTeamId: row.proposerTeamId,
    counterpartyTeamId: row.counterpartyTeamId,
    proposerAssetIds: assetPlayerIds(row.proposerAssets),
    counterpartyAssetIds: assetPlayerIds(row.counterpartyAssets),
  }));
}

interface ReDerivedTradeValue {
  readonly balance: TradeBalance;
  readonly gap: number;
  readonly giving: readonly ValuedPlayer[];
  readonly receiving: readonly ValuedPlayer[];
}

/**
 * Re-derives a completed trade's value long after `evaluateTradeBeforeExecute`'s own window (the
 * rosters a moment before they moved) has closed. Both traded assets have settled somewhere by
 * sweep time — ORDINARILY on the other side of this very trade, unless a later trade moved one of
 * them again — so this reads the UNION of both teams' CURRENT rosters, at the trade's own
 * `weekNumber`, rather than trusting either team alone the way the pre-execute read could.
 *
 * THAT `weekNumber` IS THE ACCEPT-TIME WEEK (final review, CRITICAL 1): `acceptTrade` re-stamps
 * the row with the week it derived at the moment of the yes, so this sweep re-prices the trade at
 * the week it actually happened in. Before that fix the field was whatever the proposing client
 * had named, and this "safety net" re-derived at the same evaded week — a sweep that looked at a
 * rigged trade and passed it.
 *
 * GHOST-PLAYER DISCIPLINE, LEDGERED: `valuePlayers` silently drops an id neither roster in the
 * union answers for (a player waived out of the pool, or moved on again by a later trade this
 * sweep has no reason to chase), and this function makes the SAME length check
 * `evaluateTradeBeforeExecute` already makes — mirrored, not reinvented. A trade this sweep
 * cannot see both sides of degrades HONESTLY: it returns `null`, the caller skips it and moves on
 * to the next candidate, and nothing here ever values a vanished player at zero to manufacture a
 * verdict.
 */
async function reDeriveAcceptedTradeValue(db: Db, row: UnflaggedAcceptedTrade): Promise<ReDerivedTradeValue | null> {
  const [proposerContext, counterpartyContext] = await Promise.all([
    assembleAdvisorContext(db, { leagueId: row.leagueId, teamId: row.proposerTeamId, weekNumber: row.weekNumber }),
    assembleAdvisorContext(db, { leagueId: row.leagueId, teamId: row.counterpartyTeamId, weekNumber: row.weekNumber }),
  ]);
  if (proposerContext === null || counterpartyContext === null) return null; // a team no longer resolves

  const pool: AdvisorTeamContext = { ...proposerContext.me, players: [...proposerContext.me.players, ...counterpartyContext.me.players] };
  const giving = valuePlayers(pool, row.proposerAssetIds);
  const receiving = valuePlayers(pool, row.counterpartyAssetIds);
  if (giving.length !== row.proposerAssetIds.length || receiving.length !== row.counterpartyAssetIds.length) return null; // ghost — degrade honestly

  const balance = tradeBalance(giving, receiving);
  return { balance, gap: fairnessGap(balance), giving, receiving };
}

export interface SweepTradeFairnessInput {
  /** All leagues when omitted — the manual re-run has no single trigger to scope it to. */
  readonly leagueId?: string;
  readonly newId?: () => string;
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
}

export interface SweepTradeFairnessResult {
  /** Accepted trades whose fairness question nothing has answered yet — no `trade` flag and no
   *  `held_trade` one (`unflaggedAcceptedTrades`' own docblock for why a hold counts) — that this
   *  sweep examined. Bounded at `INTEGRITY_CONFIG.trade.sweepBatchSize`, never every unflagged
   *  trade this league has ever had. */
  readonly tradesChecked: number;
  readonly flagsRaised: number;
}

/**
 * The manual re-run for `raiseTradeFairnessFlag`'s own after-commit call (Task 6, ruling 22):
 * `scripts/sweep-trade-fairness.ts` is the operator door onto this. Every candidate is raised in
 * its OWN transaction (`raiseTradeFairnessFlag`'s own `db.transaction`), sequentially — the same
 * "a later failure must not roll back an earlier, correctly-raised flag" shape
 * `sweepLeagueForMultiAccounts` already holds to, because the manager whose trade raised flag #1
 * did nothing wrong and neither did the platform's own read of it.
 *
 * FLAGS ONLY: this raises questions into the operator queue and does nothing else —
 * `src/integrity/flag-only.test.ts` covers the directory this function lives in.
 */
export async function sweepUnflaggedTrades(db: Db, input: SweepTradeFairnessInput): Promise<SweepTradeFairnessResult> {
  const clock = input.clock ?? systemClock;
  const newId = input.newId ?? (() => crypto.randomUUID());
  const candidates = await unflaggedAcceptedTrades(db, input.leagueId, INTEGRITY_CONFIG.trade.sweepBatchSize);

  let flagsRaised = 0;
  for (const row of candidates) {
    const value = await reDeriveAcceptedTradeValue(db, row);
    if (value === null) continue; // ghost — degrades honestly, never crashes the rest of the sweep

    const flag = await raiseTradeFairnessFlag(db, {
      tradeId: row.id,
      leagueId: row.leagueId,
      balance: value.balance,
      gap: value.gap,
      giving: value.giving,
      receiving: value.receiving,
      basis: "sweep_rederivation",
      occurredAt: clock.now(),
      newId,
      audit: input.audit,
    });
    if (flag !== null) flagsRaised += 1;
  }

  return { tradesChecked: candidates.length, flagsRaised };
}

// ---------------------------------------------------------------------------------------------
// Plan D, Task 5, fix round 1 (Finding 1): a held trade's own `trade_hold` flag closes HONESTLY
// once the world supersedes it — a real `flag_resolved` event, a real `superseded_before_review`
// resolution, never a raw table write.
// ---------------------------------------------------------------------------------------------

const SUPERSEDED_BEFORE_REVIEW_NOTE = "A different trade moved one of these players before an operator could decide this one.";

export interface CloseSupersededHoldFlagInput {
  readonly tradeId: string;
  readonly leagueId: string;
  readonly occurredAt: string;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
}

/**
 * Closes a held trade's own `trade_hold` flag once `acceptTrade`'s or `releaseHeldTradeInTx`'s
 * own supersede sweep has already moved that trade to `superseded` — the question this flag was
 * asking no longer has an answer to give, and closing it HONESTLY means the same three things
 * every other resolution in this product means: a real audit event, a real (system) decision, and
 * a stamp `resolveFlag`'s own detail read recognizes as resolved.
 *
 * IT IS A SEPARATE TRANSACTION, AND THAT IS NOT A CONVENIENCE — the identical reasoning
 * `raiseTradeFairnessFlag`'s own docblock states, restated for the RESOLUTION side of the same
 * constraint: the supersede sweep that discovers a held trade needs closing runs INSIDE the
 * accepting (or releasing) trade's own LEAGUE-scoped transaction, and `flag_resolved` is
 * PLATFORM-scoped (ruling 1: a record about a review is not the league's business). One
 * transaction may append to at most one chain (Plan A ruling 3), so this cannot run inside that
 * transaction and does not try to.
 *
 * THE CONSEQUENCE, STATED, the identical shape `raiseTradeFairnessFlag`'s own docblock states: a
 * process that dies between the superseding trade's own commit and this call leaves an open
 * `trade_hold` flag over a trade that is already `superseded`. This is SAFELY INERT, never
 * corrupting — `releaseHeldTradeInTx`/`blockHeldTradeInTx` both already refuse a non-`held` row
 * with a clean 409 (`"This trade is no longer waiting on a decision."`), so the worst this window
 * produces is a queue entry with no possible operator resolution until it closes. `npm run
 * trades:sweep` (`sweepSupersededHoldFlags`, below) is the re-run — the same operator remedy
 * `raiseTradeFairnessFlag`'s own after-commit gap already carries.
 *
 * SYSTEM-AUTHORED, NEVER AN OPERATOR'S: `resolvedByUserId: null`, `actorId: null`,
 * `actorType: "system"` — the identical construction every other system-authored write in this
 * product carries (`raiseFlag`'s own `raisedByUserId: null` when the platform's own sweep raises
 * a flag). `resolution: "superseded_before_review"` is declared `SYSTEM_ONLY` in
 * `@/integrity/flags` for exactly this reason: an operator must never be able to speak this word.
 *
 * IDEMPOTENT: a flag that is already closed (a previous call already landed, the trade was never
 * held at all, or there is no open `trade_hold` flag for this trade for any other reason) answers
 * `false` and writes nothing — the same "no second event" shape `raiseFlag`'s own open-subject
 * index gives its callers, achieved here with a guarded `UPDATE` (`WHERE resolved_at IS NULL`)
 * rather than a unique index, since resolving (unlike raising) has no conflict to catch. Under
 * real CONCURRENCY too, not only in sequence: the second caller's UPDATE blocks on the row the
 * first holds and then re-evaluates its own guard against the committed value.
 *
 * LOCK ORDER, and the FK acquisitions enumerated (final review F10 — this was the last of this
 * plan's nine writers with no proof in `src/integrity-service/lock-order.test.ts`, which now
 * drives it on two connections):
 *   1. the `integrity_flags` row, taken by the guarded UPDATE itself. No `FOR KEY SHARE` on
 *      `leagues` comes with it: `integrity_flags.league_id` does carry a foreign key, but Postgres
 *      locks a referenced row only when a statement WRITES the referencing key column, and this
 *      one writes the four resolution columns and never `league_id`.
 *   2. `audit.record` — the PLATFORM anchor, ALWAYS last. This transaction touches `leagues` at no
 *      point, so it cannot be half of the join-versus-append cycle ruling 3 exists for.
 */
export async function closeSupersededHoldFlag(db: Db, input: CloseSupersededHoldFlagInput): Promise<boolean> {
  const audit = input.audit ?? getAuditLogger();
  const decision: ResolutionDecision = "superseded_before_review";

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(integrityFlags)
      .set({ resolvedAt: new Date(input.occurredAt), resolvedByUserId: null, resolution: decision, resolutionNote: SUPERSEDED_BEFORE_REVIEW_NOTE })
      .where(and(eq(integrityFlags.subjectType, "held_trade"), eq(integrityFlags.subjectId, input.tradeId), isNull(integrityFlags.resolvedAt)))
      .returning();
    if (row === undefined) return false;

    // THE AUDIT EVENT IS THE RECORD — `resolveFlag`'s own docblock, restated: a `flag_resolved`
    // event, on the PLATFORM chain, is what makes this a real resolution and not a silent stamp.
    await audit.record(tx, {
      eventType: "flag_resolved",
      actorId: null,
      actorType: "system",
      leagueId: null, // platform chain — ruling 1
      payload: { flagId: row.id, flagType: "trade_hold", decision, subjectType: "held_trade", subjectId: input.tradeId, leagueId: input.leagueId },
      occurredAt: input.occurredAt,
    });
    return true;
  });
}

export interface CloseSupersededHoldFlagsQuietlyInput {
  readonly tradeIds: readonly string[];
  readonly leagueId: string;
  readonly occurredAt: string;
  readonly audit?: AuditLogger;
}

/**
 * Closes every one of `tradeIds`' own `trade_hold` flags and swallows each failure individually,
 * with a log — the identical discipline `raiseFairnessFlagQuietly` (`@/league-service/trades`)
 * keeps for its own after-commit trigger, and for the identical reason: the superseding trade
 * already committed, its own supersede sweep already ran, and a failure here leaves nothing but
 * an open flag over an already-inert trade (`closeSupersededHoldFlag`'s own docblock). The two
 * callers this exists for — `acceptTrade`'s own post-commit step and `resolveFlag`'s
 * `trade_released` branch, after `releaseHeldTradeInTx`'s own transaction commits — both run a
 * supersede sweep that can name more than one held trade at once, so this loops rather than
 * making each caller loop its own copy.
 */
export async function closeSupersededHoldFlagsQuietly(db: Db, input: CloseSupersededHoldFlagsQuietlyInput): Promise<void> {
  for (const tradeId of input.tradeIds) {
    try {
      await closeSupersededHoldFlag(db, { tradeId, leagueId: input.leagueId, occurredAt: input.occurredAt, audit: input.audit });
    } catch (error: unknown) {
      console.error("[integrity-service] superseded-hold flag close failed", { tradeId, leagueId: input.leagueId }, error);
    }
  }
}

/** One open `trade_hold` flag this sweep still owes a look — its own id and the trade it names. */
interface OpenHeldFlagOverSupersededTrade {
  readonly tradeId: string;
  readonly leagueId: string;
}

/**
 * Every OPEN `trade_hold` flag whose named trade has ALREADY moved to `superseded` — the
 * crash-window candidates `closeSupersededHoldFlag`'s own after-commit call missed. `leagueId` is
 * read off the FLAG row, never the trade — a `trade_hold` flag's own `leagueId` is required at
 * raise time (`holdTradeInTx`, `@/league-service/trades`) and is never null, the same "FK-
 * guaranteed" reasoning `subjectFor`'s own trade branch uses for a comparable lookup. Bounded at
 * `INTEGRITY_CONFIG.trade.sweepBatchSize`, the identical "an operator script that reads an
 * unbounded set is a script nobody runs twice" reason that field's own docblock states.
 */
async function openHeldFlagsOverSupersededTrades(db: Db, leagueId: string | undefined, limit: number): Promise<readonly OpenHeldFlagOverSupersededTrade[]> {
  const rows = await db
    .select({ tradeId: integrityFlags.subjectId, leagueId: integrityFlags.leagueId })
    .from(integrityFlags)
    .innerJoin(tradeProposals, eq(tradeProposals.id, integrityFlags.subjectId))
    .where(
      and(
        eq(integrityFlags.flagType, "trade_hold"),
        isNull(integrityFlags.resolvedAt),
        eq(tradeProposals.status, "superseded"),
        leagueId === undefined ? undefined : eq(integrityFlags.leagueId, leagueId),
      ),
    )
    .limit(limit);
  return rows.map((row) => ({ tradeId: row.tradeId, leagueId: row.leagueId! }));
}

export interface SweepSupersededHoldFlagsInput {
  /** All leagues when omitted — the manual re-run has no single trigger to scope it to. */
  readonly leagueId?: string;
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
}

export interface SweepSupersededHoldFlagsResult {
  /** Open `trade_hold` flags over an already-superseded trade this sweep examined — bounded at
   *  `INTEGRITY_CONFIG.trade.sweepBatchSize`, never every such flag this league has ever had. */
  readonly flagsChecked: number;
  readonly flagsClosed: number;
}

/**
 * The manual re-run for `closeSupersededHoldFlag`'s own after-commit call (fix round 1, ruling 22
 * restated): `scripts/sweep-trade-fairness.ts` runs this ALONGSIDE `sweepUnflaggedTrades`, the
 * same script, because both are re-runs of the identical class of after-commit gap on the
 * identical trade-flag machinery — an operator asking "did every trade-flag write that should
 * have landed actually land" gets one answer, not two commands to remember.
 *
 * FLAGS ONLY, in the sense that matters here: this RESOLVES a flag it did not raise and moves no
 * roster and touches no account — `src/integrity/flag-only.test.ts` covers the directory this
 * function lives in.
 */
export async function sweepSupersededHoldFlags(db: Db, input: SweepSupersededHoldFlagsInput = {}): Promise<SweepSupersededHoldFlagsResult> {
  const clock = input.clock ?? systemClock;
  const candidates = await openHeldFlagsOverSupersededTrades(db, input.leagueId, INTEGRITY_CONFIG.trade.sweepBatchSize);

  let flagsClosed = 0;
  for (const candidate of candidates) {
    const closed = await closeSupersededHoldFlag(db, { tradeId: candidate.tradeId, leagueId: candidate.leagueId, occurredAt: clock.now(), audit: input.audit });
    if (closed) flagsClosed += 1;
  }

  return { flagsChecked: candidates.length, flagsClosed };
}
