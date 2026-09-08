import { fail, ok, parseJson } from "@/lib/api/respond";
import { clientDraftActionSchema, draftStateView, toDraftAction } from "@/draft-engine";
import { getDraftStore } from "@/draft-service";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import { withDraftActor, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Submit a pick, nomination or bid. The acting team is resolved from the session — the body
 * schema has no teamId, and TIMER_EXPIRE isn't in it either: only the server ticker may
 * expire a clock.
 *
 * Nothing else rides this request (founder report 2026-09-08): a mock room's bots pick at
 * their own seeded delay after this pick lands, driven by the room's SSE advance loop
 * (`runDraftAdvanceLoop`, woken by this very pick's frame) and advance-on-read — never inside
 * the pick's own request, where a second driver of the same stretch raced the loop and a burst
 * of bot picks landed all at once.
 */
export async function POST(request: Request, context: RouteContext) {
  return withDraftActor(request, context, async (actor, req) => {
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);

    const parsed = await parseJson(req, clientDraftActionSchema);
    if (!parsed.ok) return parsed.response;

    const action = toDraftAction(parsed.value, actor.teamId, new Date().toISOString());
    const result = await getDraftStore().applyAction(actor.draftId, action, { actor: { id: actor.userId } });
    if (!result.ok) return fail(result.reason, 409);
    return ok({ draft: draftStateView(result.state) });
  });
}
