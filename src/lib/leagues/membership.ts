import { and, eq } from "drizzle-orm";
import type { NextResponse } from "next/server";
import type { Db } from "@/db/client";
import { leagues, teams } from "@/db/schema";
import { fail } from "@/lib/api/respond";

export interface LeagueMembership {
  readonly leagueId: string;
  /** The caller's team in this league, or null if they don't have one. */
  readonly teamId: string | null;
  readonly isCommissioner: boolean;
}

export type MembershipResult =
  | { readonly ok: true; readonly membership: LeagueMembership }
  | { readonly ok: false; readonly status: number; readonly error: string };

/**
 * The one place anything learns whether a user belongs to a league: do they field a team
 * there, or are they its commissioner? Shared by `resolveDraftActor` (which already knows
 * the league id, having resolved it from a draft id) and any route that only ever has a
 * league id to start from (the league's SSE stream) — so the membership query itself is
 * written once.
 */
export async function resolveLeagueMembership(db: Db, leagueId: string, userId: string): Promise<MembershipResult> {
  const [league] = await db.select({ commissionerUserId: leagues.commissionerUserId }).from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) return { ok: false, status: 404, error: "That league doesn't exist." };

  const [team] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, leagueId), eq(teams.userId, userId)));

  return {
    ok: true,
    membership: {
      leagueId,
      teamId: team?.id ?? null,
      isCommissioner: league.commissionerUserId === userId,
    },
  };
}

/**
 * Anything with a resolved team-or-commissioner status in a league — `LeagueMembership` and
 * `DraftActor` both satisfy this structurally, so one predicate serves both without either
 * importing the other's module.
 */
export interface LeagueMembershipLike {
  readonly teamId: string | null;
  readonly isCommissioner: boolean;
}

/**
 * The one 403 rule for "must belong to this league": a signed-in caller who fields no team
 * here and isn't its commissioner is a stranger. Returns the `fail()` response to
 * short-circuit with, or null when the caller may proceed. Shared by every route gated on
 * league membership (the draft board, the player pool, and the league's SSE stream) so the
 * predicate and its message can never drift between them.
 */
export function requireLeagueMember(membership: LeagueMembershipLike): NextResponse | null {
  if (membership.teamId === null && !membership.isCommissioner) {
    return fail("You don't have a team in this league.", 403);
  }
  return null;
}
