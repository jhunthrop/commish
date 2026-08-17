import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { clientDraftActionSchema, draftStateView, toDraftAction } from "@/draft-engine";
import { getDraftStore, resolveDraftActor } from "@/draft-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly draftId: string }>;
}

/**
 * Submit a pick, nomination or bid. The acting team is resolved from the session — the body
 * schema has no teamId, and TIMER_EXPIRE isn't in it either: only the server ticker may
 * expire a clock.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  const { draftId } = await params;

  const parsed = await parseJson(request, clientDraftActionSchema);
  if (!parsed.ok) return parsed.response;

  const actor = await resolveDraftActor(getDb(), draftId, user.id);
  if (!actor.ok) return fail(actor.error, actor.status);
  if (actor.actor.teamId === null) return fail("You don't have a team in this league.", 403);

  const action = toDraftAction(parsed.value, actor.actor.teamId, new Date().toISOString());
  const result = await getDraftStore().applyAction(draftId, action);
  if (!result.ok) return fail(result.reason, 409);

  return ok({ draft: draftStateView(result.state) });
}
