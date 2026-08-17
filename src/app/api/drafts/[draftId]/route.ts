import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fail, ok } from "@/lib/api/respond";
import { draftStateView } from "@/draft-engine";
import { getDraftStore, resolveDraftActor } from "@/draft-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly draftId: string }>;
}

/** The current materialized draft state plus the derived clock the UI renders. */
export async function GET(_request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  const { draftId } = await params;

  const actor = await resolveDraftActor(getDb(), draftId, user.id);
  if (!actor.ok) return fail(actor.error, actor.status);

  const state = await getDraftStore().getDraftState(draftId);
  if (state === null) return fail("That draft doesn't exist.", 404);

  return ok({ draft: draftStateView(state), teamId: actor.actor.teamId, isCommissioner: actor.actor.isCommissioner });
}
