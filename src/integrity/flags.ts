/**
 * The dispute queue's vocabulary. Pure: no database, no clock, no I/O. `src/integrity-service/
 * flags.ts` is what writes rows; this file is what decides which words exist.
 */
export const FLAG_TYPES = [
  /** Raised by this plan's detector, league-bounded, never platform-wide. */
  "multi_account",
  /** Raised by `reportReview`. `review_reports` stays the insert-only signal; this is the decision. */
  "review_report",
  /** Raised by `reportMessage`. Covers a GIF with no second path: a GIF is one chat_messages row. */
  "chat_report",
  /** Raised by Plan C's `raiseTradeFairnessFlag`, after an acceptance commits, and re-raised by
   *  `sweepUnflaggedTrades` for any accepted trade over the threshold that has no flag. */
  "trade_fairness",
  /**
   * Raised by Plan D's `acceptTrade` (`@/league-service/trades`), INSIDE the same transaction
   * that stamps a trade `held` — never after commit, unlike `trade_fairness`. The hold is
   * platform-scoped from the moment it exists (ruling 12): nothing about it is league news, so
   * there is no league-chain append to wait on and no after-commit gap for a dying process to
   * leave. See `evaluateTradeBeforeExecute`'s own `hold` field (`@/integrity-service/trade-
   * fairness`) and `acceptTrade`'s docblock for the full accounting.
   */
  "trade_hold",
] as const;
export type FlagType = (typeof FLAG_TYPES)[number];

/** What a flag's `subject_id` names. */
export const FLAG_SUBJECT_TYPES = ["account_pair", "review", "chat_message", "trade", "held_trade"] as const;
export type FlagSubjectType = (typeof FLAG_SUBJECT_TYPES)[number];

/**
 * Which subject type each flag type points at. Exhaustive: a new flag type declared without an
 * entry here will not compile. `raiseFlag` (`@/integrity-service/flags`) derives `subject_type`
 * from this rather than trusting a caller to pass the right one.
 *
 * `trade_hold`'s subject is `held_trade`, a DIFFERENT subject type than `trade_fairness`'s own
 * `trade` even though both can name the identical trade id — a trade that is merely FLAGGED has
 * already executed and reads as ordinary league history everywhere else in the product; a trade
 * that is HELD has not, and never will unless an operator releases it. One subject type standing
 * for both would force every reader (the queue's `about`, the detail page, `resolveFlag`'s own
 * `DECISION_WIRED_FOR` gate) to re-derive which case it is from context; two subject types make
 * the open-flag uniqueness index (`(subject_type, subject_id)`) and every consumer's exhaustive
 * `Record` say it once.
 */
export const SUBJECT_OF: Readonly<Record<FlagType, FlagSubjectType>> = {
  multi_account: "account_pair",
  review_report: "review",
  chat_report: "chat_message",
  trade_fairness: "trade",
  trade_hold: "held_trade",
};

export const RESOLUTION_DECISIONS = [
  /** The operator looked and nothing needs to happen. Notices nobody, on purpose (ruling 6). */
  "no_action",
  /** The operator's own words reach the member as a notice. */
  "warned_user",
  /** The reported content is stamped removed in the same transaction as the decision. */
  "content_removed",
  /**
   * Plan C owns this, and Plan C is where it stops being reserved: `reverseTradeInTx`
   * (`@/league-service/trade-reversal`) is the real compensating transfer, wired for the `trade`
   * subject type in `DECISION_WIRED_FOR` below. Compare `account_restricted`, which is not
   * declared at all: it has no owning plan, and the spec forbids account actions in this phase.
   */
  "trade_reversed",
  /**
   * Plan D's first way out of a hold (Task 5): the trade the two managers agreed to actually
   * executes, exactly as `acceptTrade` would have executed it had the gap never crossed the
   * auto-hold threshold — re-validated and re-priced at the moment of release, never assumed
   * still true from the moment of the hold (the same "enforce at the moment it happens" rule
   * `acceptTrade`'s own ownership re-check already keeps). Wired for `held_trade` alone.
   */
  "trade_released",
  /**
   * Plan D's second way out of a hold (Task 5): the trade never executes, and both rosters stay
   * exactly as they were. TERMINAL (`TERMINAL_STATUSES.blocked`, `@/trades/lifecycle`) — there is
   * no third decision that revisits a blocked trade, the same one-way discipline every other
   * resolution in this table already keeps. Wired for `held_trade` alone.
   */
  "trade_blocked",
] as const;
export type ResolutionDecision = (typeof RESOLUTION_DECISIONS)[number];

/**
 * Which plan may exercise each decision — PROVENANCE, kept even after the wiring below makes
 * `decisionIsAvailable` stop asking it. Exhaustive: a new decision without an owner will not
 * compile. `"plan-d"` is wired the SAME COMMIT it is declared: there is no Plan E to reserve
 * `trade_released`/`trade_blocked` for, the same reasoning that landed `trade_reversed` wired the
 * moment Plan C declared it.
 */
export const DECISION_OWNER: Readonly<Record<ResolutionDecision, "plan-b" | "plan-c" | "plan-d">> = {
  no_action: "plan-b",
  warned_user: "plan-b",
  content_removed: "plan-b",
  trade_reversed: "plan-c",
  trade_released: "plan-d",
  trade_blocked: "plan-d",
};

/**
 * Which decisions this product can actually carry out, against which subjects. TWO axes in one
 * exhaustive table, so "can an operator do this to this?" is answered in ONE place rather than by
 * three consumers each re-deriving half of it: the queue detail page (`flagDetailFor`, `@/
 * integrity/queue-view`, which decisions to offer), `resolveFlag` (`@/integrity-service/flags`,
 * which to refuse before it writes) and `resolveFlagSchema`'s own `.refine` (the boundary, via
 * `decisionIsAvailable` below).
 *
 * It replaces two narrower answers this file used to give: `decisionIsAvailable`, which used to
 * ask `DECISION_OWNER[decision] === "plan-b"` — a question about which PLAN wrote a thing, right
 * only while ownership and wiring agreed, and this is the commit where they part (`trade_reversed`
 * is still owned by `plan-c` and is now wired) — and `CONTENT_REMOVAL_WIRED_FOR`, which asked the
 * honest question on one axis only. `contentRemovalIsWiredFor` is derived from this table rather
 * than deleted, so the diff at every existing consumer of it is zero.
 *
 * `no_action` is wired for everything EXCEPT `held_trade`, deliberately: an operator must always
 * be able to close a question by deciding nothing needs to happen, whatever the question was
 * about — except a hold, where "nothing needs to happen" is not an available answer. `no_action`'s
 * own docblock notices nobody BECAUSE NOTHING HAPPENED (`NOTICE_FOR_DECISION.no_action` is
 * `null`, `@/integrity-service/flags`), and a held trade cannot stay held forever (founder
 * decision #10's own default: no expiry, but not indefinite silence either) — using `no_action`
 * to leave it exactly where it is would make the one decision that means "nothing happened"
 * strand two managers who are still waiting on an answer, which is a lie this table is built to
 * catch at compile time rather than let an operator discover in production. `held_trade` gets two
 * decisions instead, `trade_released`/`trade_blocked`, and each is honest about which of the two
 * things actually happened.
 * `warned_user` is not wired for `account_pair`, unchanged from before: a pair flag names two
 * people and a warning names one. It is also not wired for `held_trade`, for the identical
 * "nothing this table lets happen without doing something" reason `no_action` is not: a warning
 * notices the member and changes nothing about the trade, leaving it stuck exactly where
 * `no_action` would have.
 */
export const DECISION_WIRED_FOR: Readonly<Record<ResolutionDecision, Readonly<Record<FlagSubjectType, boolean>>>> = {
  no_action: { review: true, chat_message: true, account_pair: true, trade: true, held_trade: false },
  warned_user: { review: true, chat_message: true, account_pair: false, trade: true, held_trade: false },
  content_removed: { review: true, chat_message: true, account_pair: false, trade: false, held_trade: false },
  /** Plan C. A trade is not content and cannot be removed; the decision a trade takes is to be
   *  put back. Not wired for `held_trade`: a held trade never executed, so there is nothing on
   *  it for a reversal to undo — the same distinction `TRADE_STATUSES`' own docblock draws
   *  between `held` and `accepted`. */
  trade_reversed: { review: false, chat_message: false, account_pair: false, trade: true, held_trade: false },
  /** Plan D. The trade the two managers agreed to actually executes. Wired for `held_trade`
   *  alone: an already-executed `trade` has nothing left to release. */
  trade_released: { review: false, chat_message: false, account_pair: false, trade: false, held_trade: true },
  /** Plan D. The trade never executes, and both rosters stay exactly as they were. Wired for
   *  `held_trade` alone, for the identical reason `trade_released` is. */
  trade_blocked: { review: false, chat_message: false, account_pair: false, trade: false, held_trade: true },
};

export function decisionIsWiredFor(decision: ResolutionDecision, subjectType: FlagSubjectType): boolean {
  return DECISION_WIRED_FOR[decision][subjectType];
}

/** True when this decision is wired for at least one subject type — the "does this control do
 *  anything at all?" question this function has always answered, now derived from the two-axis
 *  table above rather than from `DECISION_OWNER`. */
export function decisionIsAvailable(decision: ResolutionDecision): boolean {
  return FLAG_SUBJECT_TYPES.some((subject) => decisionIsWiredFor(decision, subject));
}

/**
 * Which subject types `content_removed` actually has a remover wired for — derived from
 * `DECISION_WIRED_FOR` above (final review, LOW 13's original discipline, unchanged in shape):
 * "does this decision work on this subject?" is answered in ONE place rather than by three
 * consumers each re-deriving it — the queue detail page (which decisions to offer), `resolveFlag`
 * (which to refuse before it writes) and `removeSubject` (the backstop that throws).
 */
export function contentRemovalIsWiredFor(subjectType: FlagSubjectType): boolean {
  return decisionIsWiredFor("content_removed", subjectType);
}

/**
 * How a `trade_fairness` flag's evidence was computed — Task 6 fix round 1 (review MEDIUM 1).
 * `evidence` is written ONCE, at raise time, and never rewritten, so this is the one honest way
 * an operator can tell a flag `acceptTrade`'s own after-commit call raised (the score frozen
 * inside the accept transaction, from the rosters a moment before they moved) apart from one
 * `npm run trades:sweep` raised later (re-derived from whichever rosters hold the assets today —
 * see `reDeriveAcceptedTradeValue`'s own docblock, `@/integrity-service/trade-fairness`).
 *
 * A flag raised before this field existed carries no `basis` at all — `subjectFor`
 * (`@/integrity-service/flags`) reads that honestly as "unknown" rather than guessing one of the
 * two, the same "malformed or missing reads as absent" discipline every other evidence reader in
 * this file holds to.
 */
export const TRADE_FAIRNESS_BASES = ["accept_evaluation", "sweep_rederivation"] as const;
export type TradeFairnessBasis = (typeof TRADE_FAIRNESS_BASES)[number];
