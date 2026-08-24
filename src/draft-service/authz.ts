import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts } from "@/db/schema";
import { resolveLeagueMembership } from "@/lib/leagues/membership";

export interface DraftActor {
  readonly draftId: string;
  readonly leagueId: string;
  /** The caller's own id — never client-supplied, always the resolved session user. Read by
   *  `POST /api/drafts/[draftId]/actions` to attribute a pick's audit event to a real person. */
  readonly userId: string;
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
 *
 * The team/commissioner lookup itself lives in `resolveLeagueMembership` (shared with the
 * league's SSE route) — this only adds the draft → league resolution on top of it.
 */
export async function resolveDraftActor(db: Db, draftId: string, userId: string): Promise<ActorResult> {
  const [draft] = await db.select({ leagueId: drafts.leagueId }).from(drafts).where(eq(drafts.id, draftId));
  if (draft === undefined) return { ok: false, status: 404, error: "That draft does not exist." };

  const membership = await resolveLeagueMembership(db, draft.leagueId, userId);
  // A draft's `leagueId` is a NOT NULL foreign key, so its league existing is guaranteed —
  // this branch is unreachable in practice, but resolveLeagueMembership's type still allows
  // it, and surfacing the draft's own 404 here (rather than the league's) keeps the error
  // scoped to what the caller actually asked about.
  if (!membership.ok) return { ok: false, status: 404, error: "That draft does not exist." };

  return {
    ok: true,
    actor: {
      draftId,
      leagueId: draft.leagueId,
      userId,
      teamId: membership.membership.teamId,
      isCommissioner: membership.membership.isCommissioner,
    },
  };
}
