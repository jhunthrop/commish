export const TRADE_STATUSES = [
  /** Live, answerable, and counting against the proposer's open cap. */
  "open",
  /** Both managers agreed and the rosters moved. TERMINAL. A later reversal stamps
   *  `reversed_at` on this row rather than moving it to a `reversed` status: the acceptance
   *  happened, and a status that erased it would make the audit trail and the row disagree. */
  "accepted",
  /** The counterparty said no. TERMINAL. */
  "rejected",
  /** The proposer took it back. TERMINAL. */
  "withdrawn",
  /** Nobody answered inside `TRADE_CONFIG.proposalTtlHours`. TERMINAL, and reached lazily on
   *  read or accept rather than by a scheduler. */
  "expired",
  /** A DIFFERENT trade moved a player this offer names, so this offer can no longer be honored.
   *  TERMINAL, set by `acceptTrade`'s supersede sweep, and distinct from `rejected` because
   *  nobody rejected it and the copy a manager reads has to say so. */
  "superseded",
] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

export const TERMINAL_STATUSES: Readonly<Record<TradeStatus, boolean>> = {
  open: false, accepted: true, rejected: true, withdrawn: true, expired: true, superseded: true,
};

export type TradeTransition = "accept" | "reject" | "withdraw" | "expire" | "supersede";

/** Which status each transition produces. Exhaustive: a new transition without a target will
 *  not compile. */
const TARGET_OF: Readonly<Record<TradeTransition, TradeStatus>> = {
  accept: "accepted", reject: "rejected", withdraw: "withdrawn", expire: "expired", supersede: "superseded",
};

/**
 * Every transition is legal from `open` and from nowhere else. Stated as a function rather than
 * left implicit because the guard that actually enforces it is in SQL (`WHERE status = 'open'`),
 * and a rule enforced only in SQL is a rule no test can read.
 */
export function transitionIsLegal(from: TradeStatus): boolean {
  return !TERMINAL_STATUSES[from];
}

export function nextStatusFor(transition: TradeTransition): TradeStatus {
  return TARGET_OF[transition];
}
