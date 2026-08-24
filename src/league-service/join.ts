import { and, eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { drafts, leagues, memberNotices, teams, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { defaultSweepDeps, sweepQuietly, type SweepDeps } from "@/integrity-service/multi-account";
import { attachAuditEvent, notifyAffectedMember } from "@/integrity-service/notify";
import { hasOpenSeat } from "@/matchmaking/filter";
import { SEAT_HOLD_REFUSALS } from "@/matchmaking/seat-hold";
import { ENFORCEMENT_REFUSALS, tierJoinPrecondition } from "./enforcement";
import { fireWhenFullInTx } from "./fill-trigger";
import { consumeSeatHoldInTx, liveHoldsFor } from "./seat-hold";

/** The unique index that backstops "the same person joined twice" — see `schema.ts`. */
const TEAM_MEMBERSHIP_UNIQUE_INDEX = "teams_league_user_idx";

export const LEAGUE_MISSING = "That league doesn't exist.";
export const LEAGUE_FULL = "That league is already full.";
export const NOT_PUBLIC = "That league isn't open to join. Ask its commissioner for an invite link.";
export const DRAFT_ALREADY_STARTED = "That league's draft has already started. Try another open league.";

export type JoinLeagueOutcome =
  | {
      readonly ok: true;
      readonly leagueId: string;
      readonly teamId: string;
      readonly alreadyMember: boolean;
      /**
       * Phase 3.6, Task 6: what became of `input.holdToken`, when one was supplied and the
       * caller reached the seat. `"consumed"` — a live hold was redeemed by THIS join, the
       * return flow's own "you're in" moment. `"expired"` — a token was real but had run out, so
       * this join proceeded as an ordinary walk-in instead (the return flow's "we put you in it
       * anyway"). `undefined` — no token was ever in play (an invite accept, an ordinary signed-
       * in "Join" click, or a token that named nothing real). Absent rather than `"none"` so
       * every caller that predates holds never has to spell a value it never asked about.
       */
      readonly holdOutcome?: "consumed" | "expired";
    }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * A path-specific gate, run INSIDE the join transaction and only for a caller who is not
 * already a member. Returning a failure short-circuits the join; returning null lets it
 * proceed. See `joinLeagueInTx` for why it runs where it does.
 *
 * Carries the joining `userId` (Task 3): a precondition that could not ask a question about a
 * PERSON, only about the league, could never enforce `@/league-service/enforcement`'s tier rule.
 * `invitePrecondition` (`./invites.ts`) ignores it — fewer parameters than a type declares is
 * legal TypeScript, and that is the matched pair expressed as a type rather than as a test: an
 * invite's own two bounds (expiry, use count) are never a question about who is asking.
 */
export type JoinPrecondition = (tx: DbTx, leagueId: string, userId: string) => Promise<JoinLeagueOutcome | null>;

export interface JoinLeagueInput {
  readonly leagueId: string;
  readonly userId: string;
  readonly teamName?: string;
  readonly newId: () => string;
  /** Which door this seat was taken through — recorded on the `member_joined` audit event. */
  readonly via: "invite" | "public_browse";
  readonly occurredAt: string;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /**
   * Phase 3.6, Task 6: the opaque seat-hold token from `POST /api/public/leagues/[leagueId]/hold`'s
   * cookie, when the caller (`returnFromSignIn`, below) is redeeming one. `undefined`/`null` for
   * every other caller — an invite accept, or an ordinary signed-in "Join" click — which run the
   * capacity check exactly as they always have, now simply also counting anyone ELSE's live hold
   * against it (see the capacity check's own comment).
   */
  readonly holdToken?: string | null;
}

/**
 * "Give this user a team in this league", with the capacity rule and the lock that makes it
 * true under concurrency. Shared verbatim by BOTH ways into a league — an invite accept
 * (`acceptInvite`) and a public matchmaking join (`joinPublicLeague`) — because two
 * independently-written capacity checks are two places the same league's fill count can
 * disagree, and the disagreement only shows up as a 13th team in a 12-team league.
 *
 * **The lock.** The LEAGUE row is taken `FOR UPDATE` before any team is counted. Two people
 * arriving down two different paths (or on two different invite codes) share no other row, so
 * without this they both read "11 of 12" and both insert. Locking the league serializes every
 * accept for that league whatever door it came through. Callers may hold other locks first —
 * `acceptInvite` locks the invite row before calling this — and invite-then-league is the fixed
 * order in this codebase; this function never takes a lock in the other direction, so nothing
 * here can deadlock against it.
 *
 * **LOCK ORDER, ENUMERATED (final whole-branch review, F1).** In statement order this transaction
 * takes: `leagues[X] FOR UPDATE`; the `teams` INSERT (implicit `FOR KEY SHARE` on `leagues` —
 * already held — and on `users`, a row nothing in this codebase ever takes `FOR UPDATE`);
 * `fireWhenFullInTx`'s `UPDATE drafts SET kickoff_at` (the draft row, plus `leagues FOR KEY SHARE`
 * again) and its `member_notices` inserts; then the audit anchor, LAST. That is leagues-then-
 * drafts-then-anchor, which is the branch-wide rule every transaction touching both rows now
 * obeys: `setDraftKickoff` (`./draft-schedule`) locks the league before the draft, and
 * `applyAction` (`@/draft-service/store`) takes `leagues FOR KEY SHARE` before `drafts FOR UPDATE`.
 * Both previously-cyclic pairs are driven on two real connections in
 * `src/integrity-service/lock-order.test.ts`'s "the leagues-before-drafts rule" block.
 *
 * **PHASE 3.6, TASK 6 — the seat hold's own place in this order.** `consumeSeatHoldInTx`
 * (`./seat-hold`), when `input.holdToken` is present, runs immediately after the already-member
 * check — an `UPDATE seat_holds SET consumed_at ...` by primary key, which takes no lock beyond
 * the row it updates and adds no new edge to the order above (`seat_holds`' own docblock,
 * `@/db/schema`). `liveHoldsFor`'s own read (the capacity check, below) is a plain `SELECT`,
 * likewise no new lock. Both run while `leagues[X] FOR UPDATE` is already held, which is what
 * serializes either of them against a concurrent `claimSeatHold` on the same league — see that
 * function's own FK enumeration in `./seat-hold`.
 *
 * **Why the precondition runs where it does.** Every path-specific gate (an invite's expiry and
 * use cap, a public league's listing and draft status) is checked AFTER the "are you already a
 * member" lookup and BEFORE the capacity check. That ordering is the rule that makes re-arriving
 * free: opening your own invite link again after it expired, or reloading a browse card after
 * the draft started, finds your existing team and succeeds rather than telling a member they
 * cannot join the league they are already in.
 *
 * Runs inside the CALLER's transaction on purpose: for the invite path, joining is one step of a
 * larger write that also bumps the invite's use count, and a half-applied join is not a state
 * anything should be able to observe.
 */
export async function joinLeagueInTx(
  tx: DbTx,
  input: JoinLeagueInput,
  precondition?: JoinPrecondition,
): Promise<JoinLeagueOutcome> {
  const [league] = await tx
    .select({ id: leagues.id, teamCount: leagues.teamCount })
    .from(leagues)
    .where(eq(leagues.id, input.leagueId))
    .for("update");
  if (league === undefined) return { ok: false, status: 404, reason: LEAGUE_MISSING };

  const [existing] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.leagueId, league.id), eq(teams.userId, input.userId)));
  // Arriving twice is not an error, and costs nothing.
  if (existing !== undefined) return { ok: true, leagueId: league.id, teamId: existing.id, alreadyMember: true };

  // PHASE 3.6, TASK 6. Redeemed BEFORE the precondition below, deliberately: Step 3's own rule is
  // that "a held seat that a tier refusal rejects is released immediately rather than left to
  // expire" — a hold this transaction marks consumed here COMMITS even when the precondition
  // refuses the join a few lines down (this callback returns a value rather than throwing, and
  // Drizzle commits a transaction on normal return), which is exactly how "released immediately"
  // becomes true rather than merely intended. Nothing is queued for a token that is absent,
  // already spent, or simply never real — see `consumeSeatHoldInTx`'s own docblock for why
  // `"absent"` is silently treated as no hold at all rather than a refusal.
  let holdOutcome: "consumed" | "expired" | undefined;
  if (input.holdToken !== undefined && input.holdToken !== null) {
    const consumed = await consumeSeatHoldInTx(tx, { token: input.holdToken, leagueId: league.id, now: input.occurredAt });
    if (consumed.ok) {
      holdOutcome = "consumed";
    } else if (consumed.reason === SEAT_HOLD_REFUSALS.expired) {
      holdOutcome = "expired";
    } else if (consumed.reason === SEAT_HOLD_REFUSALS.spent) {
      return { ok: false, status: 409, reason: SEAT_HOLD_REFUSALS.spent };
    }
    // `"absent"`: fall through exactly as though no token had been supplied at all.
  }

  if (precondition !== undefined) {
    const denied = await precondition(tx, league.id, input.userId);
    if (denied !== null) return denied;
  }

  const filled = await tx.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, league.id));
  if (filled.length >= league.teamCount) {
    return { ok: false, status: 409, reason: LEAGUE_FULL };
  }
  // A caller who just redeemed a LIVE hold already had a seat reserved for them at claim time
  // (`claimSeatHold`'s own capacity check) — the plain count above is this join's own safety net
  // for that case, never re-widened by `liveHoldsFor`, which would otherwise count the caller's
  // OWN hold (already marked consumed, so it would not, but re-reading it costs a query for
  // nothing). Everyone else — no token, an absent one, or one that just expired — is checked
  // against real seats PLUS anyone else's still-live hold, so a seat somebody is mid-claiming
  // reads as taken, not open, for anybody without that exact claim's own token.
  if (holdOutcome !== "consumed") {
    const liveHolds = await liveHoldsFor(tx, league.id, input.occurredAt);
    if (!hasOpenSeat({ teamCount: league.teamCount, filledTeams: filled.length }, liveHolds)) {
      return { ok: false, status: 409, reason: SEAT_HOLD_REFUSALS.taken };
    }
  }

  const [profile] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, input.userId));
  const teamId = input.newId();
  await tx.insert(teams).values({
    id: teamId,
    leagueId: league.id,
    userId: input.userId,
    name: input.teamName ?? profile?.displayName ?? "New team",
  });
  const audit = input.audit ?? getAuditLogger();
  // Phase 3.5, Task 7: "a time, not a button". Called unconditionally, after every seat this
  // codebase ever takes, through BOTH doors that reach `joinLeagueInTx` (an invite accept and a
  // public browse join) — `fireWhenFullInTx` (`./fill-trigger`) answers "is this now full, and
  // does this league's draft even fire on filling" for itself, and no-ops for the overwhelming
  // majority of joins (a `'scheduled'` draft, or a league with a seat still open) at the cost of
  // one cheap read. See its own docblock for why it lives here rather than as a second call keyed
  // to "was this the last seat".
  //
  // ABOVE THE `member_joined` APPEND, and that is ruling 3 rather than taste (final whole-branch
  // review, F1c). This call takes real locks — `UPDATE drafts SET kickoff_at` (the draft row, plus
  // `leagues FOR KEY SHARE` through its FK) and a `member_notices` insert per seated member — and
  // it shipped BELOW an `audit.record` that had already taken the chain anchor, which is exactly
  // the "no FK-carrying write after the anchor" invariant `@/integrity-service/audit-logger`'s own
  // docblock states and exactly the shape of the cycle that invariant was written to close. The
  // order is now the same one every other audited writer on this branch holds: business writes
  // (the `teams` insert, the kickoff `UPDATE`), then notices, then `audit.record`, then
  // `attachAuditEvent`, ANCHOR LAST. `fireWhenFullInTx` appends to this same league's chain, so
  // the `member_joined` append below finds the anchor already held by this transaction and takes
  // no new lock at all.
  await fireWhenFullInTx(tx, league.id, input.occurredAt, audit);
  // Inside the same transaction, after the seat exists and before the caller sees it. Placed
  // here rather than in `acceptInvite` and `joinPublicLeague` separately for exactly the reason
  // the capacity check lives here: two copies of one rule are two places it can disagree.
  await audit.record(tx, {
    eventType: "member_joined",
    actorId: input.userId,
    actorType: "user",
    leagueId: league.id,
    payload: { teamId, via: input.via },
    occurredAt: input.occurredAt,
  });
  return { ok: true, leagueId: league.id, teamId, alreadyMember: false, holdOutcome };
}

/**
 * The multi-account sweep's JOIN-TIME trigger (ruling 11) — one of the two places in this plan an
 * integrity write is deliberately outside its business transaction. Both doors into a league
 * (`joinPublicLeague`, below, and `acceptInvite` in `@/league-service/invites`) call this AFTER
 * their own `db.transaction(...)` has committed, never from inside `joinLeagueInTx` itself. The
 * lock-order reasoning, and the swallow that keeps a failed sweep from failing a join, both live
 * in `sweepQuietly` (`@/integrity-service/multi-account`) — one implementation, shared with the
 * draft store's completion trigger.
 *
 * A no-op for anything that isn't a BRAND NEW seat (`!outcome.ok`, or `outcome.alreadyMember`):
 * the pair set of a league changes exactly when a seat is FILLED, never when an existing member
 * merely re-arrives.
 *
 * WHAT THIS TRIGGER CAN AND CANNOT DO (final review, HIGH 2). It is the only moment the pair SET
 * changes, so it belongs here — but on its own it can never raise a flag, and that is arithmetic,
 * not a bug: a join is refused once the draft leaves `scheduled` (`publicJoinPrecondition`) and
 * no seat reopens afterwards, so the league has zero `MAKE_PICK` rows at every real firing,
 * `behavioralSimilarity` returns its sample floor of 0, and the remaining weight cannot reach
 * `flagThreshold`. The draft-completion trigger (`@/draft-service/store`) is what makes the
 * detector reachable; this one becomes meaningful the day the `ip` weight leaves zero.
 */
export async function triggerMultiAccountSweep(db: Db, outcome: JoinLeagueOutcome, deps: SweepDeps = defaultSweepDeps()): Promise<void> {
  if (!outcome.ok || outcome.alreadyMember) return;
  await sweepQuietly(db, outcome.leagueId, "league_join", deps);
}

/**
 * The public browse page's gate: a league must still be LISTED, still be PRE-DRAFT, and (Task 3)
 * this account must not be tier-segregated out of it. Every clause is re-checked here rather than
 * trusted from the card the visitor clicked, because a browse page is a snapshot and a league can
 * fill, start or (for the third clause) a caller's own participation tier can cross a threshold
 * between the render and the press.
 *
 * Answers 404, not 403, for "not public": `acceptInvite` deliberately collapses "the league is
 * gone" into "the invite is invalid" rather than confirming a league id is real to a stranger
 * who merely holds it (`invites.ts:119-121`). The public join door must make the same call — a
 * 403 here would tell a caller "this id names a real, private league", which is exactly the
 * existence oracle a signed-in stranger posting an id should not get. `joinPublicLeague`, below,
 * remaps `joinLeagueInTx`'s own LEAGUE_MISSING 404 to this same shape so the two cases (no such
 * league; a real but private one) answer byte-identically.
 *
 * THE TIER CLAUSE (`tierJoinPrecondition`, `@/league-service/enforcement`) runs LAST — after the
 * public check and after the draft-status check — so a caller who has not yet proved the league is
 * public and open never reaches a tier answer at all. That ordering is what keeps this refusal from
 * becoming a second existence oracle: a 409 here can only ever follow a league this caller already
 * knows is public, listed and pre-draft.
 *
 * FK LOCK ENUMERATION (Plan C's H2 lesson, binding). This precondition runs inside `joinLeagueInTx`'s
 * transaction, AFTER its `leagues[id] FOR UPDATE`. Its own reads take:
 *   - `leagues` + `drafts`: plain SELECT, no lock beyond the one already held (this statement now
 *     also selects `experienceTier`, the same row, no second query).
 *   - `teams` + `leagues` (the completed-season count, `tierJoinPrecondition` -> `completedSeasonsFor`):
 *     plain SELECT.
 * It takes NO new lock and writes nothing. The block's own notice, audit event and refusal are
 * written by `joinPublicLeague`, below, AFTER the transaction has rolled back, in a SEPARATE
 * platform-scoped transaction (`recordTierBlockedJoin`) — because a refused join must not leave a
 * league-chain row behind, and because the refusal itself is what the caller is waiting for.
 */
export const publicJoinPrecondition: JoinPrecondition = async (tx, leagueId, userId) => {
  const [row] = await tx
    .select({ isPublicMatchmade: leagues.isPublicMatchmade, draftStatus: drafts.status, experienceTier: leagues.experienceTier })
    .from(leagues)
    .leftJoin(drafts, eq(drafts.leagueId, leagues.id))
    .where(eq(leagues.id, leagueId));
  if (row === undefined || !row.isPublicMatchmade) return { ok: false, status: 404, reason: NOT_PUBLIC };
  if (row.draftStatus !== null && row.draftStatus !== "scheduled") {
    return { ok: false, status: 409, reason: DRAFT_ALREADY_STARTED };
  }
  if (await tierJoinPrecondition(tx, row, userId)) {
    return { ok: false, status: 409, reason: ENFORCEMENT_REFUSALS.join };
  }
  return null;
};

/**
 * The tier block's own record, written by `joinPublicLeague` AFTER `joinLeagueInTx`'s transaction
 * has already committed (or, with no writes queued, rolled back to the same observable effect) —
 * never inside it. A refused join writes NOTHING to the league it refused for the ordinary case
 * (`joinLeagueInTx` never queues a write for a precondition denial on its own); the ONE exception,
 * added by Phase 3.6, Task 6, is a caller who arrived holding a LIVE seat-hold token that this
 * same refused attempt just redeemed — that hold's `consumed_at` stamp DOES commit, on purpose
 * (Step 3: "a held seat that a tier refusal rejects is released immediately rather than left to
 * expire"), and it is the only durable trace a tier-blocked join with a hold ever leaves. This is
 * a wholly separate platform-scoped transaction, on the
 * PLATFORM chain (`leagueId: null`), because a league nobody joined is not told about it
 * (`SYSTEM_ACTION_SUMMARY_ALLOWED.tier_blocked_join` is `false`, and this event carries no
 * `summary` field at all).
 *
 * DEDUPED, once per `(userId, leagueId)`: a bounded read against `member_notices` filtered on
 * `(user_id, league_id, notice_type)` — the same "derive over a bounded set" rule `listNotices`
 * already follows — before either the notice or the audit event is written, so a visitor who
 * presses "Join" on the same reserved league five times gets five identical refusals but exactly
 * one notice and one platform-chain event, not five.
 *
 * Best-effort: a failure here is logged and swallowed, never surfaced as the join's own response.
 * The refusal the caller receives (`ENFORCEMENT_REFUSALS.join`) is already correct and complete
 * without this write succeeding — the account did nothing wrong, and a broken notice pipe must not
 * turn an honest 409 into a scary 500, the same reasoning `triggerMultiAccountSweep` swallows for.
 */
export async function recordTierBlockedJoin(
  db: Db,
  input: { readonly leagueId: string; readonly userId: string; readonly occurredAt: string; readonly audit?: AuditLogger },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [already] = await tx
      .select({ id: memberNotices.id })
      .from(memberNotices)
      .where(and(eq(memberNotices.userId, input.userId), eq(memberNotices.leagueId, input.leagueId), eq(memberNotices.noticeType, "tier_blocked_join")))
      .limit(1);
    if (already !== undefined) return;

    // `leagues.id` is the row `publicJoinPrecondition` just read moments ago inside the now-rolled-
    // back join transaction — it can only be gone here if the league was deleted in the interim,
    // which this product has no path to do; a defensive `undefined` check costs one branch.
    const [league] = await tx.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, input.leagueId));
    if (league === undefined) return;

    const notice = await notifyAffectedMember(tx, {
      leagueId: input.leagueId,
      userId: input.userId,
      noticeType: "tier_blocked_join",
      context: { leagueName: league.name },
      occurredAt: input.occurredAt,
      auditEventId: null,
    });
    const event = await (input.audit ?? getAuditLogger()).record(tx, {
      eventType: "system_action",
      actorId: null,
      actorType: "system",
      leagueId: null,
      payload: { action: "tier_blocked_join", subjectUserId: input.userId },
      occurredAt: input.occurredAt,
    });
    await attachAuditEvent(tx, notice, event.eventId);
  });
}

export interface JoinPublicLeagueInput {
  readonly leagueId: string;
  readonly userId: string;
  readonly teamName?: string;
  /** Phase 3.6, Task 6 — see `JoinLeagueInput.holdToken`'s own docblock. Spread straight through
   *  to `joinLeagueInTx` below; an ordinary "Join" click never sets it. */
  readonly holdToken?: string | null;
}

/**
 * Join an open, publicly listed league without an invite. The counterpart to `acceptInvite`,
 * and deliberately built on the same core: the two doors differ only in what they check before
 * seating somebody, never in how a seat is counted or taken.
 */
export async function joinPublicLeague(
  { db, newId, clock, audit }: { readonly db: Db; readonly newId: () => string; readonly clock: Clock; readonly audit?: AuditLogger },
  input: JoinPublicLeagueInput,
): Promise<JoinLeagueOutcome> {
  try {
    const outcome = await db.transaction((tx) =>
      joinLeagueInTx(tx, { ...input, newId, via: "public_browse", occurredAt: clock.now(), audit }, publicJoinPrecondition),
    );
    // `joinLeagueInTx` itself answers LEAGUE_MISSING (404) before `publicJoinPrecondition` ever
    // runs — remap it to the SAME shape the precondition answers a real-but-private league
    // with, so a caller cannot tell "no such league" apart from "a league that exists but isn't
    // public" (see `publicJoinPrecondition`'s docblock, and `acceptInvite`'s identical collapse).
    if (!outcome.ok && outcome.status === 404) return { ok: false, status: 404, reason: NOT_PUBLIC };
    // The tier block: the join transaction above has already rolled back with nothing written.
    // This is the ONLY branch that reaches `recordTierBlockedJoin` — a string-equality check
    // against the one shared constant `publicJoinPrecondition` and this function both import,
    // never a second copy of the refusal text to drift out of step with it.
    if (!outcome.ok && outcome.reason === ENFORCEMENT_REFUSALS.join) {
      try {
        await recordTierBlockedJoin(db, { leagueId: input.leagueId, userId: input.userId, occurredAt: clock.now(), audit });
      } catch (error: unknown) {
        console.error("[league] tier-blocked join notice failed", { leagueId: input.leagueId, userId: input.userId }, error);
      }
      return outcome;
    }
    await triggerMultiAccountSweep(db, outcome);
    return outcome;
  } catch (error: unknown) {
    if (isUniqueViolation(error, TEAM_MEMBERSHIP_UNIQUE_INDEX)) {
      // The unique-index backstop fired: a concurrent join created this user's team first.
      // That is a success, not a 500 — find the team they now have and hand it back.
      const [existing] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));
      if (existing !== undefined) {
        return { ok: true, leagueId: input.leagueId, teamId: existing.id, alreadyMember: true };
      }
    }
    console.error("[league] public join failed", { leagueId: input.leagueId }, error);
    return { ok: false, status: 500, reason: "We couldn't join that league just now. Please try again." };
  }
}

export interface ReturnFromSignInInput {
  readonly leagueId: string;
  readonly userId: string;
  /** The hold cookie's value, or `null` when there is none — a visitor who never held a seat, or
   *  whose cookie did not survive the round trip, is treated on the SAME predicate as one whose
   *  hold expired: what decides is whether the room has room, never whether a receipt exists. */
  readonly holdToken: string | null;
  readonly now: string;
}

export type ReturnFromSignInOutcome =
  | {
      readonly ok: true;
      readonly seated: true;
      /** A LIVE hold was redeemed by this exact request — outcome (a), Task 6 Step 4. */
      readonly justSeated: boolean;
      /** A hold existed but had run out, and a seat was still open regardless — outcome (b). */
      readonly expiredHold: boolean;
      readonly leagueId: string;
      readonly teamId: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * "The return" (Task 6 Step 4, F4): a signed-in visitor arriving back at the hold interstitial,
 * with or without the cookie `POST /api/public/leagues/[leagueId]/hold` set before they left for
 * WorkOS. Built ENTIRELY on `joinPublicLeague` rather than a second copy of its transaction, its
 * tier handling and its multi-account trigger (DRY, and the two doors' capacity rule staying one
 * rule rather than two that could drift) — the only thing this function adds is translating
 * `JoinLeagueOutcome.holdOutcome` into the two flags the interstitial's screens need, and
 * collapsing every "no seat" shape (a league that was always full, one a hold made full, a token
 * that named nothing real) into ONE vocabulary word, `SEAT_HOLD_REFUSALS.taken` — a visitor who
 * signed in to find their seat gone does not need to know WHY, only that it is (Step 4's own
 * "shows the race loser the taken panel rather than a refusal code").
 *
 * The ONE refusal kept distinct is the tier block (`ENFORCEMENT_REFUSALS.join`): a visitor turned
 * away for who they are, not for bad luck, is owed the honest reason, not a shrug — and
 * `joinPublicLeague` has already recorded it (`recordTierBlockedJoin`) by the time this returns.
 */
export async function returnFromSignIn(db: Db, input: ReturnFromSignInInput): Promise<ReturnFromSignInOutcome> {
  const clock: Clock = { now: () => input.now };
  const outcome = await joinPublicLeague(
    { db, newId: () => crypto.randomUUID(), clock },
    { leagueId: input.leagueId, userId: input.userId, holdToken: input.holdToken },
  );
  if (!outcome.ok) {
    if (outcome.reason === ENFORCEMENT_REFUSALS.join) return { ok: false, reason: ENFORCEMENT_REFUSALS.join };
    return { ok: false, reason: SEAT_HOLD_REFUSALS.taken };
  }
  return {
    ok: true,
    seated: true,
    justSeated: outcome.holdOutcome === "consumed",
    expiredHold: outcome.holdOutcome === "expired",
    leagueId: outcome.leagueId,
    teamId: outcome.teamId,
  };
}
