import { and, eq, notExists, sql } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { integrityFlags, tradeProposals } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { assembleAdvisorContext, valuePlayers, type AdvisorTeamContext } from "@/ai-advisor/context";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { assetPlayerIds } from "@/trades/assets";
import { crossesFairnessThreshold, fairnessGap, tradeBalance, type TradeBalance, type ValuedPlayer } from "@/trades/fairness";
import { getAuditLogger, type AuditLogger } from "./audit-logger";
import { raiseFlag, type IntegrityFlag } from "./flags";

const systemClock: Clock = { now: () => new Date().toISOString() };

export interface EvaluateTradeInput {
  readonly leagueId: string;
  /** The week this trade is valued at — `trade_proposals.weekNumber`, unchanged since propose
   *  time. Read-only here: this function moves nothing, so there is no "as of when" question
   *  beyond which week's roster/scoring context to price the two sides against. */
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
  /** At or past `INTEGRITY_CONFIG.trade.autoHoldThreshold`. Always `false` while that is `null`.
   *  Plan D acts on it, INSIDE the accept transaction, by not executing. */
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
 * `autoHoldThreshold` is `null` on merge, so `hold` is `false` for every trade this plan
 * executes.
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

function evidenceFor(input: Pick<RaiseTradeFairnessInput, "balance" | "gap" | "giving" | "receiving">, threshold: number) {
  return {
    verdict: input.balance.verdict,
    // Stored VERBATIM — the analyzer's own machine-readable reasons, never re-summarized.
    flags: input.balance.flags,
    givingValue: input.balance.givingValue,
    receivingValue: input.balance.receivingValue,
    gap: input.gap,
    threshold,
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
 * Every ACCEPTED trade with no `trade_fairness` flag at all — open OR resolved, never just open —
 * scoped to one league when `leagueId` is supplied, every league otherwise. `NOT EXISTS` rather
 * than a `LEFT JOIN … IS NULL`: `integrity_flags` has no foreign key onto `trade_proposals` (a
 * flag's `subject_id` is plain text, matching every other subject type), so this is a correlated
 * subquery, not an index-backed join. Bounded at `INTEGRITY_CONFIG.trade.sweepBatchSize` for the
 * same "an operator script that reads an unbounded set is a script nobody runs twice" reason that
 * field's own docblock states.
 */
async function unflaggedAcceptedTrades(db: Db, leagueId: string | undefined, limit: number): Promise<readonly UnflaggedAcceptedTrade[]> {
  const rows = await db
    .select()
    .from(tradeProposals)
    .where(
      and(
        eq(tradeProposals.status, "accepted"),
        leagueId === undefined ? undefined : eq(tradeProposals.leagueId, leagueId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(integrityFlags)
            .where(and(eq(integrityFlags.subjectType, "trade"), eq(integrityFlags.subjectId, tradeProposals.id))),
        ),
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
  /** Accepted trades with no `trade_fairness` flag this sweep examined — bounded at
   *  `INTEGRITY_CONFIG.trade.sweepBatchSize`, never every unflagged trade this league has ever
   *  had. */
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
      occurredAt: clock.now(),
      newId,
      audit: input.audit,
    });
    if (flag !== null) flagsRaised += 1;
  }

  return { tradesChecked: candidates.length, flagsRaised };
}
