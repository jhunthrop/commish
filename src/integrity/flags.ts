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
  /** RESERVED — Plan C raises this from its post-acceptance fairness check. */
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
   * RESERVED — Plan C owns this. There is no trade in this product to reverse, so `resolveFlag`
   * refuses it and `decisionIsAvailable` returns false. Plan C turns it on by adding the subject
   * type and the reversal, together, in one commit. Compare `account_restricted`, which is not
   * declared at all: it has no owning plan, and the spec forbids account actions in this phase.
   */
  "trade_reversed",
] as const;
export type ResolutionDecision = (typeof RESOLUTION_DECISIONS)[number];

/** Which plan may exercise each decision. Exhaustive: a new decision without an owner will not compile. */
export const DECISION_OWNER: Readonly<Record<ResolutionDecision, "plan-b" | "plan-c">> = {
  no_action: "plan-b",
  warned_user: "plan-b",
  content_removed: "plan-b",
  trade_reversed: "plan-c",
};

export function decisionIsAvailable(decision: ResolutionDecision): boolean {
  return DECISION_OWNER[decision] === "plan-b";
}

/**
 * Which subject types `content_removed` actually has a remover wired for. Exhaustive: a new
 * subject type declared without an entry here will not compile, so "does this decision work on
 * this subject?" is answered in ONE place rather than by three consumers each re-deriving it —
 * the queue detail page (which decisions to offer), `resolveFlag` (which to refuse before it
 * writes) and `removeSubject` (the backstop that throws).
 *
 * Final review, LOW 13: `resolveFlagSchema` accepted `content_removed` for any flag, and a direct
 * POST against an `account_pair` flag reached `removeSubject`'s unwired branch, threw a plain
 * `Error`, and became a 500. Admin-only and fail-safe (the transaction rolled back), but a 500 is
 * not a refusal — it is a crash that happened to be harmless, and the boundary should say no in
 * the product's own words.
 */
export const CONTENT_REMOVAL_WIRED_FOR: Readonly<Record<FlagSubjectType, boolean>> = {
  review: true,
  chat_message: true,
  /** Two accounts, not a piece of content. `warned_user` is not wired for it either — a pair
   *  flag names two people and a warning names one. */
  account_pair: false,
  /** RESERVED for Plan C, alongside `trade_reversed`, which is the decision a trade takes. */
  trade: false,
};

export function contentRemovalIsWiredFor(subjectType: FlagSubjectType): boolean {
  return CONTENT_REMOVAL_WIRED_FOR[subjectType];
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
