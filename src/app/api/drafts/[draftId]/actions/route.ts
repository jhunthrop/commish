import { fail, ok, parseJson } from "@/lib/api/respond";
import { clientDraftActionSchema, draftStateView, toDraftAction } from "@/draft-engine";
import { getDraftStore, simMockToNextHumanTurn } from "@/draft-service";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import { withDraftActor, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Submit a pick, nomination or bid. The acting team is resolved from the session — the body
 * schema has no teamId, and TIMER_EXPIRE isn't in it either: only the server ticker may
 * expire a clock.
 *
 * For a MOCK draft, a landed pick triggers the sim lane before answering (sim-to-next-pick,
 * the founder's directive — see `simMockToNextHumanTurn`): in a solo room every bot between
 * this pick and the human's next turn picks inside THIS request, and the response body carries
 * the post-sim board, so the lone human is back on the clock the moment their screen updates.
 * The re-read after the sim is what makes that true; a sim that lands nothing (a multi-human
 * room, a finished draft) just answers the same state the pick produced.
 */
export async function POST(request: Request, context: RouteContext) {
  return withDraftActor(request, context, async (actor, req) => {
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);

    const parsed = await parseJson(req, clientDraftActionSchema);
    if (!parsed.ok) return parsed.response;

    const action = toDraftAction(parsed.value, actor.teamId, new Date().toISOString());
    const result = await getDraftStore().applyAction(actor.draftId, action, { actor: { id: actor.userId } });
    if (!result.ok) return fail(result.reason, 409);

    if (result.state.config.isMock === true) {
      await simMockToNextHumanTurn(actor.draftId);
      const simmed = await getDraftStore().getDraftState(actor.draftId);
      if (simmed !== null) return ok({ draft: draftStateView(simmed) });
    }

    return ok({ draft: draftStateView(result.state) });
  });
}
