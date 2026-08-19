/**
 * A proposed trade. **Nothing in this phase executes one** — no table stores it, no service
 * applies it, and the advisor that reads it has no write path at all (see `docs/advisor.md`).
 * It exists so the fairness analyzer has a typed input, and so the same shape is already right
 * when a later phase adds a real trade block with human accept/decline on both sides.
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
