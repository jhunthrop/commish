import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";

export interface DraftActor {
  readonly draftId: string;
  readonly leagueId: string;
  /** The caller's team in this draft's league, or null if they don't have one. */
  readonly teamId: string | null;
  readonly isCommissioner: boolean;
}

export type ActorResult =
  | { readonly ok: true; readonly actor: DraftActor }
  | { readonly ok: false; readonly status: number; readonly error: string };

/**
 * The one place a route learns who the caller is *in this draft*. Routes never read a team id
 * from a request body — this resolves it from the authenticated user id, so a client cannot
 * act as another manager by asking nicely.
 */
export async function resolveDraftActor(db: Db, draftId: string, userId: string): Promise<ActorResult> {
  const [draft] = await db
    .select({ leagueId: drafts.leagueId, commissionerUserId: leagues.commissionerUserId })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(eq(drafts.id, draftId));
  if (draft === undefined) return { ok: false, status: 404, error: "That draft doesn't exist." };

  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.leagueId, draft.leagueId), eq(teams.userId, userId)));

  return {
    ok: true,
    actor: {
      draftId,
      leagueId: draft.leagueId,
      teamId: team?.id ?? null,
      isCommissioner: draft.commissionerUserId === userId,
    },
  };
}
