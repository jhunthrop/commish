/**
 * Every system-authored action code this product knows about, the same runtime-array-plus-
 * derived-union shape `AUDIT_EVENT_TYPES` (`@/domain/audit`) uses: a code can be iterated (the
 * exhaustiveness test below does exactly that) without a hand-maintained union falling out of
 * step with its own list.
 */
export const SYSTEM_ACTION_CODES = ["stat_week_corrected", "chain_verification_failed", "lineup_auto_set", "trade_held_for_review"] as const;

export type SystemActionCode = (typeof SYSTEM_ACTION_CODES)[number];

/**
 * Which system actions may say something to a whole league, decided per action code and denying
 * by default. The THIRD deny-by-default dimension in this codebase, added to the two Plan A
 * shipped (`ACTIVITY_VISIBILITY` decides types; each payload renderer decides fields).
 *
 * WHY THIS EXISTS. `renderSystemAction` renders `payload.summary` verbatim to every member of a
 * league, and `system_action` is `"everyone"` in ACTIVITY_VISIBILITY. That has been safe only by
 * accident of what existed: the sole publisher was `scripts/verify-audit-chain.ts`, which writes
 * no `summary` and is platform-chain-scoped anyway. Plan A named the hole in its own residuals and
 * required a re-review before anything emitted a league-scoped one. This plan is that publisher,
 * so this is that re-review, and its outcome is a table rather than an approval.
 *
 * The RE-REVIEW'S ANSWER, in full, so Plan D inherits a decision instead of the question:
 *  - `stat_week_corrected` is ALLOWED. It is a fact about the league's shared scoreboard, true for
 *    everyone in it, about nobody's conduct. A member who is not told is a member reading standings
 *    that changed under them.
 *  - `chain_verification_failed` is DENIED, restating Plan A's ruling 8: telling a league its
 *    record may have been altered, before a human has read the output, is the accusation this
 *    phase spends a denylist preventing.
 *  - `lineup_auto_set` is DENIED IN ADVANCE, and Plan D should not simply flip it. The
 *    competitive-sensitivity argument that makes `lineup_change` `actor_only` (Plan A ruling 15)
 *    applies at least as hard to a system-authored sentence describing one manager's lineup, and
 *    broadcasting the lapse publicly while manual changes stay private would be worse than either.
 *    What Plan D needs is an actor-scoped path, which is a new visibility, not a new summary.
 */
export const SYSTEM_ACTION_SUMMARY_ALLOWED: Readonly<Record<SystemActionCode, boolean>> = {
  stat_week_corrected: true,
  chain_verification_failed: false,
  lineup_auto_set: false,
  trade_held_for_review: false,
};
