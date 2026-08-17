import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leagues, teams } from "@/db/schema";

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
