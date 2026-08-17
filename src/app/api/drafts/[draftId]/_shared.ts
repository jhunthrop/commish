import type { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fail } from "@/lib/api/respond";
import { resolveDraftActor, type DraftActor } from "@/draft-service";

export interface RouteContext {
  readonly params: Promise<{ readonly draftId: string }>;
}

type DraftActorHandler = (actor: DraftActor, request: Request) => Promise<NextResponse>;

/**
 * Shared auth → actor boilerplate for every `/api/drafts/[draftId]/**` route: who's signed
 * in (401 JSON, never a redirect), which draft this is and whether it exists (404), who the
 * caller is in it (`resolveDraftActor` — never a client-supplied id). Each route supplies
 * only its own extra authorization rule (membership, commissioner-only, …) and success body,
 * so the routes stay thin and the auth ordering can't drift between them.
 */
export async function withDraftActor(request: Request, { params }: RouteContext, handler: DraftActorHandler): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  const { draftId } = await params;

  const actor = await resolveDraftActor(getDb(), draftId, user.id);
  if (!actor.ok) return fail(actor.error, actor.status);

  return handler(actor.actor, request);
}
