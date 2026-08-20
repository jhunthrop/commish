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

/**
 * Open, waiting on an operator, or resolved with a decision recorded. Derived at read time from
 * `resolved_at` (ruling 5) — there is no `status` column, so this vocabulary names the two values
 * a reader computes rather than one this file stores.
 */
export const FLAG_STATUSES = ["open", "resolved"] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

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
