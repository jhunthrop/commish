import { and, eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { drafts, leagues, teams, users } from "@/db/schema";
import { hasOpenSeat } from "@/matchmaking/filter";

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
 */
export type JoinPrecondition = (tx: DbTx, leagueId: string) => Promise<JoinLeagueOutcome | null>;

export interface JoinLeagueInput {
  readonly leagueId: string;
  readonly userId: string;
  readonly teamName?: string;
  readonly newId: () => string;
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
    const denied = await precondition(tx, league.id);
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
  return { ok: true, leagueId: league.id, teamId, alreadyMember: false };
}

/**
 * The public browse page's gate: a league must still be LISTED and still be PRE-DRAFT. Both are
 * re-checked here rather than trusted from the card the visitor clicked, because a browse page
 * is a snapshot and a league can fill or start between the render and the press.
 */
const publicJoinPrecondition: JoinPrecondition = async (tx, leagueId) => {
  const [row] = await tx
    .select({ isPublicMatchmade: leagues.isPublicMatchmade, draftStatus: drafts.status })
    .from(leagues)
    .leftJoin(drafts, eq(drafts.leagueId, leagues.id))
    .where(eq(leagues.id, leagueId));
  if (row === undefined || !row.isPublicMatchmade) return { ok: false, status: 403, reason: NOT_PUBLIC };
  if (row.draftStatus !== null && row.draftStatus !== "scheduled") {
    return { ok: false, status: 409, reason: DRAFT_ALREADY_STARTED };
  }
  return null;
};

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
  { db, newId }: { readonly db: Db; readonly newId: () => string },
  input: JoinPublicLeagueInput,
): Promise<JoinLeagueOutcome> {
  try {
    return await db.transaction((tx) => joinLeagueInTx(tx, { ...input, newId }, publicJoinPrecondition));
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
