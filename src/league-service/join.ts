import { and, eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { drafts, leagues, memberNotices, teams, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { defaultSweepDeps, sweepQuietly, type SweepDeps } from "@/integrity-service/multi-account";
import { attachAuditEvent, notifyAffectedMember } from "@/integrity-service/notify";
import { hasOpenSeat } from "@/matchmaking/filter";
import { ENFORCEMENT_REFUSALS, tierJoinPrecondition } from "./enforcement";
import { fireWhenFullInTx } from "./fill-trigger";

/** The unique index that backstops "the same person joined twice" — see `schema.ts`. */
const TEAM_MEMBERSHIP_UNIQUE_INDEX = "teams_league_user_idx";

export const LEAGUE_MISSING = "That league doesn't exist.";
export const LEAGUE_FULL = "That league is already full.";
export const NOT_PUBLIC = "That league isn't open to join. Ask its commissioner for an invite link.";
export const DRAFT_ALREADY_STARTED = "That league's draft has already started. Try another open league.";

export type JoinLeagueOutcome =
  | { readonly ok: true; readonly leagueId: string; readonly teamId: string; readonly alreadyMember: boolean }
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

  if (precondition !== undefined) {
    const denied = await precondition(tx, league.id, input.userId);
    if (denied !== null) return denied;
  }

  const filled = await tx.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, league.id));
  if (!hasOpenSeat({ teamCount: league.teamCount, filledTeams: filled.length })) {
    return { ok: false, status: 409, reason: LEAGUE_FULL };
  }

  const [profile] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, input.userId));
  const teamId = input.newId();
  await tx.insert(teams).values({
    id: teamId,
    leagueId: league.id,
    userId: input.userId,
    name: input.teamName ?? profile?.displayName ?? "New team",
  });
  // Inside the same transaction, after the seat exists and before the caller sees it. Placed
  // here rather than in `acceptInvite` and `joinPublicLeague` separately for exactly the reason
  // the capacity check lives here: two copies of one rule are two places it can disagree.
  const audit = input.audit ?? getAuditLogger();
  await audit.record(tx, {
    eventType: "member_joined",
    actorId: input.userId,
    actorType: "user",
    leagueId: league.id,
    payload: { teamId, via: input.via },
    occurredAt: input.occurredAt,
  });
  // Phase 3.5, Task 7: "a time, not a button". Called unconditionally, after every seat this
  // codebase ever takes, through BOTH doors that reach `joinLeagueInTx` (an invite accept and a
  // public browse join) — `fireWhenFullInTx` (`./fill-trigger`) answers "is this now full, and
  // does this league's draft even fire on filling" for itself, and no-ops for the overwhelming
  // majority of joins (a `'scheduled'` draft, or a league with a seat still open) at the cost of
  // one cheap read. See its own docblock for why it lives here rather than as a second call keyed
  // to "was this the last seat".
  await fireWhenFullInTx(tx, league.id, input.occurredAt, audit);
  return { ok: true, leagueId: league.id, teamId, alreadyMember: false };
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
 * has already rolled back — never inside it. A refused join writes NOTHING to the league it
 * refused (that transaction is gone, and `joinLeagueInTx` never queued a write for a precondition
 * denial in the first place); this is a wholly separate platform-scoped transaction, on the
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
