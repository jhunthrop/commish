import { fail, ok } from "@/lib/api/respond";
import { draftStateView } from "@/draft-engine";
import { getDraftStore } from "@/draft-service";
import { withDraftActor, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Commissioner-only: opens the draft, fixing its order and its ranked player pool. */
export async function POST(request: Request, context: RouteContext) {
  return withDraftActor(request, context, async (actor) => {
    if (!actor.isCommissioner) return fail("Only the commissioner can start this draft.", 403);

    const result = await getDraftStore().startDraft(actor.draftId);
    if (!result.ok) return fail(result.reason, 409);

    return ok({ draft: draftStateView(result.state) });
  });
}
