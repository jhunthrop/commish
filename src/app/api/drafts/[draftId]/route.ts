import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { draftStateView, queueFor } from "@/draft-engine";
import { getDraftStore } from "@/draft-service";
import { listTeamCards } from "@/draft-service/teams";
import type { DraftSnapshotBody } from "@/draft-room/contract";
import { withLeagueMember, type RouteContext } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The current materialized draft state plus the derived clock the UI renders.
 *
 * Ruling R-B5: restricted to league members (a team in this draft's league) and the
 * commissioner — a signed-in stranger from another league gets 403, not another league's
 * board.
 */
export async function GET(request: Request, context: RouteContext) {
  return withLeagueMember(request, context, async (actor) => {
    const state = await getDraftStore().getDraftState(actor.draftId);
    if (state === null) return fail("That draft doesn't exist.", 404);

    const body: DraftSnapshotBody = {
      draft: draftStateView(state),
      teamId: actor.teamId,
      isCommissioner: actor.isCommissioner,
      teams: await listTeamCards(getDb(), actor.leagueId),
      // Own queue only. `queueFor` returns [] for a commissioner with no team.
      queue: actor.teamId === null ? [] : queueFor(state, actor.teamId),
    };
    return ok(body);
  });
}
