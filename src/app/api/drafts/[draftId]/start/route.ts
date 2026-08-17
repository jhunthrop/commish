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

/** Commissioner-only: opens the draft, fixing its order and its ranked player pool. */
export async function POST(_request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  const { draftId } = await params;

  const actor = await resolveDraftActor(getDb(), draftId, user.id);
  if (!actor.ok) return fail(actor.error, actor.status);
  if (!actor.actor.isCommissioner) return fail("Only the commissioner can start this draft.", 403);

  const result = await getDraftStore().startDraft(draftId);
  if (!result.ok) return fail(result.reason, 409);

  return ok({ draft: draftStateView(result.state) });
}
