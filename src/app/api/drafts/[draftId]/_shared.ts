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
 *
 * Also the one error boundary for every route built on it: an unexpected throw from a
 * handler (a bug, a dropped connection) is logged with its real detail server-side and
 * answered with a generic, plain-language 500 — the API-response rule is that error strings
 * are user-facing, and raw exception text must never reach a client.
 */
export async function withDraftActor(request: Request, { params }: RouteContext, handler: DraftActorHandler): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  const { draftId } = await params;

  const actor = await resolveDraftActor(getDb(), draftId, user.id);
  if (!actor.ok) return fail(actor.error, actor.status);

  try {
    return await handler(actor.actor, request);
  } catch (error: unknown) {
    console.error("[draft] route handler failed", { draftId, path: new URL(request.url).pathname }, error);
    return fail("Something went wrong on our side. Please try again.", 500);
  }
}
