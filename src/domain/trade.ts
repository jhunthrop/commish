/**
 * A proposed trade — the pure shape the advisor's fairness analyzer takes. This is not the
 * stored proposal: Phase 3 Plan C adds `trade_proposals` (`src/league-service/trades.ts`) and a
 * real execution path (`acceptTrade`, `applyTradeInTx`), so a trade DOES execute now, on a row
 * with an id, a status and timestamps this bare shape has none of. This type and
 * `isBalancedProposal` stay here rather than moving to `src/trades`, because `src/ai-advisor`
 * already imports them and a move would be churn with no property attached — see
 * `src/trades/contract.ts` for the wire types the stored, executable trade uses instead.
 */
export interface TradeSide {
  readonly teamId: string;
  readonly playerIds: readonly string[];
}

export interface TradeProposal {
  readonly leagueId: string;
  readonly weekNumber: number;
  /** The side proposing — "what I give up". */
  readonly from: TradeSide;
  /** The side being asked — "what I get back". */
  readonly to: TradeSide;
}

/**
 * The one shape check a proposal must pass before anything values it: two different teams,
 * each actually sending somebody. A one-sided gift and a team trading with itself are both
 * real inputs a form can produce and neither is a *trade* — they would make any fairness
 * verdict meaningless rather than merely lopsided.
 */
export function isBalancedProposal(proposal: TradeProposal): boolean {
  if (proposal.from.teamId === proposal.to.teamId) return false;
  return proposal.from.playerIds.length > 0 && proposal.to.playerIds.length > 0;
}
