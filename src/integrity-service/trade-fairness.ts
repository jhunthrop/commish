import type { DbTx } from "@/db/client";
import { assembleAdvisorContext, valuePlayers } from "@/ai-advisor/context";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { crossesFairnessThreshold, fairnessGap, tradeBalance, type TradeBalance } from "@/trades/fairness";

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
  };
}
