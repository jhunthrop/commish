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
] as const;
export type FlagType = (typeof FLAG_TYPES)[number];

/** What a flag's `subject_id` names. */
export const FLAG_SUBJECT_TYPES = ["account_pair", "review", "chat_message", "trade"] as const;
export type FlagSubjectType = (typeof FLAG_SUBJECT_TYPES)[number];

/**
 * Which subject type each flag type points at. Exhaustive: a new flag type declared without an
 * entry here will not compile. `raiseFlag` (`@/integrity-service/flags`) derives `subject_type`
 * from this rather than trusting a caller to pass the right one.
 */
export const SUBJECT_OF: Readonly<Record<FlagType, FlagSubjectType>> = {
  multi_account: "account_pair",
  review_report: "review",
  chat_report: "chat_message",
  trade_fairness: "trade",
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
] as const;
export type ResolutionDecision = (typeof RESOLUTION_DECISIONS)[number];

/**
 * Which plan may exercise each decision — PROVENANCE, kept even after the wiring below makes
 * `decisionIsAvailable` stop asking it. Exhaustive: a new decision without an owner will not
 * compile.
 */
export const DECISION_OWNER: Readonly<Record<ResolutionDecision, "plan-b" | "plan-c">> = {
  no_action: "plan-b",
  warned_user: "plan-b",
  content_removed: "plan-b",
  trade_reversed: "plan-c",
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
 * `no_action` is wired for everything, deliberately: an operator must always be able to close a
 * question by deciding nothing needs to happen, whatever the question was about.
 * `warned_user` is not wired for `account_pair`, unchanged from before: a pair flag names two
 * people and a warning names one.
 */
export const DECISION_WIRED_FOR: Readonly<Record<ResolutionDecision, Readonly<Record<FlagSubjectType, boolean>>>> = {
  no_action: { review: true, chat_message: true, account_pair: true, trade: true },
  warned_user: { review: true, chat_message: true, account_pair: false, trade: true },
  content_removed: { review: true, chat_message: true, account_pair: false, trade: false },
  /** Plan C. A trade is not content and cannot be removed; the decision a trade takes is to be
   *  put back. */
  trade_reversed: { review: false, chat_message: false, account_pair: false, trade: true },
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
