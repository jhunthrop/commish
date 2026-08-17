import { fail, ok } from "@/lib/api/respond";
import { draftStateView } from "@/draft-engine";
import { getDraftStore } from "@/draft-service";
import { withDraftActor, type RouteContext } from "./_shared";

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
  return withDraftActor(request, context, async (actor) => {
    if (actor.teamId === null && !actor.isCommissioner) {
      return fail("You don't have a team in this league.", 403);
    }

    const state = await getDraftStore().getDraftState(actor.draftId);
    if (state === null) return fail("That draft doesn't exist.", 404);

    return ok({ draft: draftStateView(state), teamId: actor.teamId, isCommissioner: actor.isCommissioner });
  });
}
