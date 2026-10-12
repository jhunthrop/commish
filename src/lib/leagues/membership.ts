import { and, eq } from "drizzle-orm";
import type { NextResponse } from "next/server";
import type { Db } from "@research-ts/db/client";
import { leagues, teams } from "@/db/schema";
import { fail } from "@/lib/api/respond";
import { leagueAuthority, type LeagueAuthority } from "@/league-service/authority";

/**
 * The one literal for "you don't field a team here" — shared by `requireLeagueMember` below
 * (the league-membership gate: no team AND not commissioner) and
 * `POST /api/drafts/[draftId]/actions` (a stricter, different rule: acting requires an actual
 * team, commissioner or not), so the two routes can never drift apart on the wording.
 */
export const NO_TEAM_MESSAGE = "You do not have a team in this league.";

export interface LeagueMembership {
  readonly leagueId: string;
  /** The caller's team in this league, or null if they don't have one. */
  readonly teamId: string | null;
  readonly isCommissioner: boolean;
  /** Who runs this league — a member or the platform (`@/league-service/authority`). Carried
   *  alongside `isCommissioner` rather than in place of it, so `withCommissioner`
   *  (`@/app/api/leagues/_shared`) can tell "not the commissioner because a house league has
   *  none" apart from the ordinary "not the commissioner" case, without a second query. */
  readonly authority: LeagueAuthority;
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
  const [league] = await db
    .select({ commissionerUserId: leagues.commissionerUserId, houseRung: leagues.houseRung })
    .from(leagues)
    .where(eq(leagues.id, leagueId));
  if (league === undefined) return { ok: false, status: 404, error: "That league does not exist." };

  const [team] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, leagueId), eq(teams.userId, userId)));

  // Fix round 1, F1 (LOW): computed once and read twice, rather than calling `isCommissionerOf`
  // (which re-derives the same union internally) and `leagueAuthority` separately — the union
  // resolves the row exactly once per request.
  const authority = leagueAuthority(league);

  return {
    ok: true,
    membership: {
      leagueId,
      teamId: team?.id ?? null,
      isCommissioner: authority.kind === "member" && authority.userId === userId,
      authority,
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
    return fail(NO_TEAM_MESSAGE, 403);
  }
  return null;
}
