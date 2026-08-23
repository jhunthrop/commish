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
  /**
   * Plan D's auto-hold (Task 5). Both managers agreed, but the gap between what they are
   * trading crossed `INTEGRITY_CONFIG.trade.autoHoldThreshold` in a public, platform-enforced
   * league, so NOTHING executed: no roster moved, no other offer was superseded, and a
   * `trade_hold` flag is waiting on an operator. NOT TERMINAL, and deliberately not `accepted`
   * with a nullable "held" timestamp beside it — a reversal's `reversed_at` pattern works
   * because the acceptance genuinely happened; here nothing has happened yet, and a status that
   * claimed otherwise would tell rosters a lie the database itself does not carry. `held` is
   * also not `open`: nobody may answer it (accept, reject or withdraw) the ordinary way, because
   * the offer is no longer a question between the two managers — it is a question for an
   * operator. Two ways out, both operator decisions (`resolveFlag`'s `trade_released`/
   * `trade_blocked`): released moves this row to `accepted` (the trade the two managers agreed
   * to actually executes), blocked moves it to `blocked` (it never will). A held trade can still
   * be `superseded` the same way an open one can — the world moving on is not a review outcome.
   */
  "held",
  /**
   * An operator's `trade_blocked` decision on a `held` trade (Plan D, Task 5). TERMINAL, and
   * distinct from `rejected` for the same reason `superseded` is distinct from it: neither
   * manager declined this trade, and a manager who read "declined" would draw a false
   * conclusion about their counterparty. Reachable ONLY from `held` — an operator has no
   * decision that blocks an `open` offer, because an unanswered offer was never Plan D's
   * business in the first place.
   */
  "blocked",
] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

export const TERMINAL_STATUSES: Readonly<Record<TradeStatus, boolean>> = {
  open: false, accepted: true, rejected: true, withdrawn: true, expired: true, superseded: true,
  held: false, blocked: true,
};

export type TradeTransition = "accept" | "reject" | "withdraw" | "expire" | "supersede" | "hold" | "release" | "block";

/** Which status each transition produces. Exhaustive: a new transition without a target will
 *  not compile. */
const TARGET_OF: Readonly<Record<TradeTransition, TradeStatus>> = {
  accept: "accepted", reject: "rejected", withdraw: "withdrawn", expire: "expired", supersede: "superseded",
  // Plan D (Task 5): `hold` is `acceptTrade`'s own branch when the gap crosses the auto-hold
  // threshold in an enforced public league; `release` is `resolveFlag`'s `trade_released`
  // decision (the trade the two managers agreed to actually executes); `block` is its
  // `trade_blocked` decision.
  hold: "held", release: "accepted", block: "blocked",
};

/**
 * Which status each transition may run FROM — declared once, exhaustively, rather than implied
 * by a single "is this terminal" question. `supersede` is the one verb the world can still apply
 * to a `held` trade: a held trade dies the same way an open one does when a DIFFERENT trade moves
 * one of its players, and that is the world moving on, not the fairness review's own answer.
 * Every other ordinary lifecycle verb (`accept`/`reject`/`withdraw`/`expire`) requires `open`,
 * unchanged from before this task — a held trade is no longer a question between the two
 * managers, so none of them may answer it the ordinary way. `release`/`block` are the two ways
 * out of `held`, and only of `held`: an operator has no decision that reaches an `open` offer.
 */
const SOURCE_OF: Readonly<Record<TradeTransition, readonly TradeStatus[]>> = {
  accept: ["open"], reject: ["open"], withdraw: ["open"], expire: ["open"], supersede: ["open", "held"],
  hold: ["open"], release: ["held"], block: ["held"],
};

/**
 * Whether `transition` may run from `from` — the guard that actually enforces this is in SQL
 * (a guarded `UPDATE`'s own `WHERE`), and a rule enforced only in SQL is a rule no test can
 * read. This function is that rule, restated so a test — and a reviewer — can ask it directly.
 */
export function transitionIsLegal(from: TradeStatus, transition: TradeTransition): boolean {
  return SOURCE_OF[transition].includes(from);
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
