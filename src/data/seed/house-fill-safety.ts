/**
 * Fix round 1 (Task 15, F1): the one predicate a caller asks BEFORE seating a second member into
 * an already-spawned house league, shared by `index.ts`'s own house arc and
 * `e2e/formats-and-lobby.spec.ts`'s browser journey — the two call sites that backstage-fill a
 * real, already-spawned house league rather than one they just created themselves.
 *
 * THE HAZARD. `autoStartDueDrafts` (`@/draft-service/auto-start`) has no fill-completeness
 * requirement of its own: `status = 'scheduled' AND kickoff_at <= now`, plus `store.startDraft`'s
 * own floor of two seated teams, is the whole test. A house league's kickoff is fixed once at
 * spawn time — for a `'scheduled'` rung via `houseKickoffFor` (`@/matchmaking/house-catalog`),
 * for a `'when_full'` rung via the placeholder `kickoffFor` writes instead
 * (`@/league-service/house-factory.ts`, `now + draftDaysFromCreation`) — and neither one moves
 * again on its own except `fireWhenFullInTx` rewriting a `'when_full'` league's the moment it
 * fills. Founder directive 2026-08-26: every `HOUSE_CATALOG` rung is `'when_full'` today, so this
 * hazard is entirely about that placeholder aging now, not a chosen kickoff — but the mechanism
 * and the fix are identical either way, because this predicate only ever reads the kickoff column
 * and asks whether it sits comfortably ahead, never which arm wrote it. On a long-lived shared dev
 * database, that fixed-until-filled kickoff is exactly the kind of fixture that ages out from
 * under a later run: found running Task 15's own e2e battery, where the real ticker
 * (`@/draft-service/ticker.ts`) runs alongside a backstage fill and can claim a stale-kickoff
 * draft mid-loop, turning a routine seat-taking into an intermittent `DRAFT_ALREADY_STARTED`
 * refusal that has nothing to do with whatever the caller is actually proving — the identical "a
 * seeded fixture the ticker can move" class of hazard `seed-tier-demo.ts`'s own docblock already
 * root-caused once for a shared identity pool.
 *
 * WHY NOT REWRITE THE KICKOFF INSTEAD. The legitimate write path (`PUT /api/leagues/[leagueId]/
 * draft-schedule`, `setDraftKickoff`) is commissioner-gated, and a house league has no
 * commissioner (`leagues.commissioner_user_id IS NULL` by construction, `leagues_house_
 * commissioner_ck`) — every caller, including this codebase's own seed and e2e fixtures, is
 * refused by the identical check a stranger would be. That refusal is the product working, not a
 * gap to route around with a hand-stamped `UPDATE drafts SET kickoff_at`. The only path that stays
 * inside production semantics is choosing a DIFFERENT, still-safe league to fill.
 */

/**
 * How far in the future a scheduled house league's kickoff must sit before it is safe to seat a
 * SECOND member into it. Matches the margin `e2e/global-setup.ts`'s own scheduled fixtures already
 * require for the identical reason (`ensureSlotPreferenceLeague`, `ensureDraftScheduleLeague`: both
 * pin their kickoff to `Date.now() + 2 hours`) — one convention, not a second number invented here.
 */
export const SAFE_HOUSE_FILL_KICKOFF_MARGIN_MS = 2 * 60 * 60 * 1000;

/**
 * Whether `kickoffAt` sits comfortably (`SAFE_HOUSE_FILL_KICKOFF_MARGIN_MS`) past `nowIso`. A
 * league already at ONE seat is never at risk (`store.startDraft` refuses "an empty league, or
 * one seat filled" regardless of kickoff) — this predicate exists for the moment a caller is about
 * to seat a member that would push the count to two or more.
 */
export function isSafeToKeepFillingHouseLeague(kickoffAt: Date, nowIso: string): boolean {
  return kickoffAt.getTime() - Date.parse(nowIso) >= SAFE_HOUSE_FILL_KICKOFF_MARGIN_MS;
}

/**
 * The loud failure both call sites raise when no candidate league is safe to fill — named so both
 * throw the identical sentence rather than two hand-typed copies that could drift. Never thrown
 * for a league that is already fully seated (see each call site's own "already full" shortcut):
 * this is reached only when EVERY still-open candidate is both short of capacity AND too close to
 * (or past) its own kickoff to safely finish filling.
 */
export function staleHouseShelfMessage(rung: string, callSite: string): string {
  return (
    `${callSite}: every open ${rung} house league's kickoff is within ` +
    `${SAFE_HOUSE_FILL_KICKOFF_MARGIN_MS / 60_000} minutes of now (or already past) and none is ` +
    "already fully seated — filling one further risks autoStartDueDrafts claiming its draft " +
    "mid-fill. This names a stale shelf, not a flake: a house league's kickoff never moves once " +
    "scheduled (no legitimate write path — draft-schedule is commissioner-gated and a house league " +
    "has none), so the fix is to wait for the reconciler's own next tick to open a fresher one, " +
    "never to hand-stamp a new kickoff here."
  );
}
