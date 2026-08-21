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

/** The two fields expiry is a question about — satisfied by both the stored row
 *  (`TradeProposal`, `@/league-service/trades`) and the wire view (`TradeProposalView`,
 *  `./contract`), so server and browser ask the identical function. */
export interface ExpirableProposal {
  readonly status: TradeStatus;
  readonly expiresAt: string;
}

/**
 * Pure, and the WHOLE of expiry: a row whose `expiresAt` has passed reads as expired without a
 * scheduler ever having touched it, and no `status = 'expired'` is ever written — there is no
 * event moment to write one at, so expiry is DERIVED rather than stored (the same discipline every
 * other derived state in this codebase keeps).
 *
 * Only meaningful for a row still `open`: a terminal row's `expiresAt` is a fact about an offer
 * nobody can act on any more anyway, so this returns `false` rather than double-labeling a row
 * that already says what happened to it.
 *
 * IT IS LOAD-BEARING, and lives here rather than in `@/league-service` for that reason (final
 * review, HIGH 3). It had zero production consumers: the card's "Needs your answer" badge and its
 * live Accept button both ignored expiry, so a member was shown a prominent offer whose Accept
 * always 409'd. `@/trades` is the browser-safe half, so `TradeCard` asks THIS function against its
 * own ticking clock and the two halves of the product cannot drift on what "expired" means.
 */
export function isExpired(row: ExpirableProposal, now: string): boolean {
  return row.status === "open" && new Date(row.expiresAt).getTime() <= new Date(now).getTime();
}
