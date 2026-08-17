import { fail, ok, parseJson } from "@/lib/api/respond";
import { clientDraftActionSchema, draftStateView, toDraftAction } from "@/draft-engine";
import { getDraftStore } from "@/draft-service";
import { withDraftActor, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Submit a pick, nomination or bid. The acting team is resolved from the session — the body
 * schema has no teamId, and TIMER_EXPIRE isn't in it either: only the server ticker may
 * expire a clock.
 */
export async function POST(request: Request, context: RouteContext) {
  return withDraftActor(request, context, async (actor, req) => {
    if (actor.teamId === null) return fail("You don't have a team in this league.", 403);

    const parsed = await parseJson(req, clientDraftActionSchema);
    if (!parsed.ok) return parsed.response;

    const action = toDraftAction(parsed.value, actor.teamId, new Date().toISOString());
    const result = await getDraftStore().applyAction(actor.draftId, action);
    if (!result.ok) return fail(result.reason, 409);

    return ok({ draft: draftStateView(result.state) });
  });
}
