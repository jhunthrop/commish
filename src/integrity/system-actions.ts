/**
 * Every system-authored action code this product knows about, the same runtime-array-plus-
 * derived-union shape `AUDIT_EVENT_TYPES` (`@/domain/audit`) uses: a code can be iterated (the
 * exhaustiveness test below does exactly that) without a hand-maintained union falling out of
 * step with its own list.
 */
export const SYSTEM_ACTION_CODES = [
  "stat_week_corrected",
  "chain_verification_failed",
  "lineup_auto_set",
  "trade_held_for_review",
  "tier_blocked_join",
  /**
   * The scheduler that starts a draft for a public matchmade league whose commissioner never
   * pressed the button — Task 7's own (`src/draft-service/auto-start.ts`, `autoStartDueDrafts` /
   * `startDraft`'s fused auto-announce). Vocabulary and visibility shipped ahead of the writer in Task 4;
   * this is the code's publisher, and `NoticeContexts.draft_auto_started` (`@/integrity/notices`)
   * is its own notice.
   */
  "draft_auto_started",
  /**
   * The clock skipped a manager instead of autopicking for them (Task 5, Phase 3.5) — NFFC's
   * forgiveness for a manager who never set a queue, in a tier slow enough for the room to still
   * be asleep. `NoticeContexts.draft_pick_skipped` (`@/integrity/notices`) is its own notice, the
   * same one-code-two-writers shape `draft_auto_started`/`lineup_auto_set` both already use.
   */
  "draft_pick_skipped",
  /**
   * The sit-and-go trigger (Phase 3.5, Task 7): a public matchmade league's draft, set to fire
   * when it fills rather than at a chosen time, the moment its last seat is taken
   * (`fireWhenFullInTx`, `@/league-service/fill-trigger`). `NoticeContexts.draft_fill_triggered`
   * (`@/integrity/notices`) is its own notice, the identical one-code-many-notices shape
   * `draft_auto_started` already uses.
   */
  "draft_fill_triggered",
  /**
   * The catalog reconciler (Phase 3.5 addendum, Task 13): a house league the platform opened,
   * published by `spawnHouseLeagueInTx` (`@/league-service/house-factory.ts`). No notice rides
   * with it (that module's own docblock) — a league that just opened has no members yet to
   * notify, and Task 14's shelf-replacement notice is the one this addendum sends a member.
   */
  "house_league_opened",
  /**
   * The roll (Phase 3.6, Task 7, the founder's "roll until full" ruling):
   * `rollUnfilledDraftInTx` (`@/league-service/roll`) pushing a `'scheduled'` draft's kickoff
   * forward because its room was not full at its target time. `NoticeContexts.
   * draft_kickoff_rolled` (`@/integrity/notices`) is its own notice, the identical
   * one-code-many-notices shape `draft_auto_started`/`draft_fill_triggered` both already use.
   */
  "draft_kickoff_rolled",
  /**
   * The other half of `draft_fill_triggered` (Phase 3.6, Task 8): `releaseSeat`
   * (`@/league-service/release`) clears a filled sit-and-go's `drafts.fill_fired_at` when a
   * released seat un-fills it during the grace window, and this is the fact everyone LEFT in the
   * room is owed about it — a seat opened, so the room is no longer full and its draft is back to
   * waiting for the last one. `NoticeContexts.draft_fill_reversed` (`@/integrity/notices`) is its
   * own notice, sent to every REMAINING seated team (never the member who just left, who already
   * has the Modal's own confirmation).
   */
  "draft_fill_reversed",
] as const;

export type SystemActionCode = (typeof SYSTEM_ACTION_CODES)[number];

/**
 * Who may see a system action on the member-facing activity feed, decided per action CODE and
 * denying by default. The FOURTH deny-by-default dimension in this codebase, and it SUBSUMES the
 * third (`SYSTEM_ACTION_SUMMARY_ALLOWED`, a plain boolean) rather than sitting beside it —
 * `systemActionSummaryAllowed` below is derived from this table, never a second source of truth.
 *
 * `"subject_only"` and not `"actor_only"`: a system action has no actor, by construction — every
 * `system_action` event carries `actorType: "system"`, which means `actorId: null` by the same
 * construction `ACTIVITY_VISIBILITY`'s own `actor_only` branch depends on (it compares
 * `event.actorId` to the viewer, and `null` can never equal a viewer's own id). Plan B pre-decided
 * this exact question and got the substance right and the word wrong: *"what Plan D needs is an
 * actor-scoped path, which is a new visibility, not a new summary"* — the path that actually means
 * something for an actorless event is the SUBJECT, the member the action was taken ABOUT, carried
 * on the payload as `subjectUserId` and checked by the renderer (`activity-view.ts`, ruling 8).
 *
 * THE RE-REVIEW'S ANSWER, restated in full so a later plan inherits a decision instead of the
 * question Plan A's own residual required:
 *  - `stat_week_corrected` is ALLOWED to everyone. It is a fact about the league's shared
 *    scoreboard, true for everyone in it, about nobody's conduct. A member who is not told is a
 *    member reading standings that changed under them.
 *  - `chain_verification_failed` is HIDDEN, restating Plan A's ruling 8: telling a league its
 *    record may have been altered, before a human has read the output, is the accusation this
 *    phase spends a denylist preventing.
 *  - `lineup_auto_set` is SUBJECT-scoped. The competitive-sensitivity argument that makes
 *    `lineup_change` `actor_only` (Plan A ruling 15) is unchanged and is why this is not
 *    `"everyone"`: broadcasting one manager's lapse while every manual change stays private would
 *    be worse than either.
 *  - `trade_held_for_review` is HIDDEN, and now for a structural reason rather than a provisional
 *    one: the hold's `system_action` is written on the PLATFORM chain, and a platform-chain event
 *    is never read by `listLeagueActivity` at all. The denial is no longer a decision anybody has
 *    to keep making.
 *  - `tier_blocked_join` is HIDDEN, for the identical platform-chain reason. Nobody in a league
 *    needs to know who was turned away at the door.
 *  - `draft_auto_started` is ALLOWED to everyone, on `stat_week_corrected`'s reasoning exactly: a
 *    fact about the league's shared calendar, true for everyone in it, about nobody's conduct. A
 *    member whose draft started without a human pressing anything is owed the sentence that says
 *    so.
 *  - `draft_pick_skipped` is SUBJECT-scoped, on `lineup_auto_set`'s reasoning exactly (Task 5,
 *    Phase 3.5): the competitive-sensitivity argument that keeps one manager's lapse private
 *    applies here too — a skip is forgiveness, not news the rest of the room needs broadcast to
 *    them, and the board already renders the pick as pending without naming who it is pending on.
 *  - `draft_fill_triggered` is ALLOWED to everyone (Task 7, Phase 3.5), on `draft_auto_started`'s
 *    reasoning exactly: a fact about the league's shared calendar, true for everyone in it, about
 *    nobody's conduct. A member whose draft is about to start because the room filled up is owed
 *    the sentence that says so.
 *  - `house_league_opened` is ALLOWED to everyone (Task 13, Phase 3.5 addendum): a league opening
 *    is a fact about a league nobody is in yet, true for whoever reads the chain, about nobody's
 *    conduct — the first person to walk in should be able to read that the platform opened it and
 *    when.
 *  - `draft_kickoff_rolled` is ALLOWED to everyone (Phase 3.6, Task 7), on `draft_fill_triggered`'s
 *    reasoning exactly: a fact about the league's shared calendar, true for everyone in it, about
 *    nobody's conduct. A member whose draft just moved is owed the sentence that says so, and the
 *    ruling that founded this task ("no draft ever fires below a full room") makes that sentence a
 *    load-bearing part of the promise, not merely a courtesy.
 *  - `draft_fill_reversed` is ALLOWED to everyone (Phase 3.6, Task 8), on `draft_fill_triggered`'s
 *    reasoning exactly, run in reverse: a fact about the league's shared calendar, true for
 *    everyone still in it, about nobody's conduct. A member who was told the room was about to
 *    draft is owed the sentence that says it no longer is.
 */
export type SystemActionVisibility = "everyone" | "subject_only" | "hidden";

export const SYSTEM_ACTION_VISIBILITY: Readonly<Record<SystemActionCode, SystemActionVisibility>> = {
  stat_week_corrected: "everyone",
  chain_verification_failed: "hidden",
  lineup_auto_set: "subject_only",
  trade_held_for_review: "hidden",
  tier_blocked_join: "hidden",
  draft_auto_started: "everyone",
  draft_pick_skipped: "subject_only",
  draft_fill_triggered: "everyone",
  house_league_opened: "everyone",
  draft_kickoff_rolled: "everyone",
  draft_fill_reversed: "everyone",
};

/**
 * Derived, never a second table. Every existing consumer (`activity-view.ts`'s renderer, both
 * test suites) sees a zero-line diff in what it means, the same way `contentRemovalIsWiredFor`
 * survived `DECISION_WIRED_FOR` in Plan C: `"everyone"` is the one shape a plain boolean could
 * ever have represented, so a code that is `"subject_only"` or `"hidden"` both answer `false`
 * here exactly as they did when the boolean itself said so.
 */
export function systemActionSummaryAllowed(code: SystemActionCode): boolean {
  return SYSTEM_ACTION_VISIBILITY[code] === "everyone";
}
