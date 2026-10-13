import { getDb } from "@research-ts/db/client";
import { fail, ok } from "@/lib/api/respond";
import { advisorFor } from "@/draft-service/assistant/service";
import { withLeagueMember, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE ADVISOR — the one card and the pool odds (`docs/superpowers/specs/2026-09-07-draft-
 * advisor-design.md`, section 7). `withLeagueMember` refuses a stranger with 403 before this
 * ever runs; a member with no seat of their own (a commissioner) or a draft not currently
 * `in_progress` has nothing to be advised about, which `advisorFor` answers with `null` — an
 * honest 409 rather than a 200 carrying a shape the caller cannot use. No model call happens
 * anywhere under this route.
 */
export async function GET(request: Request, context: RouteContext) {
  return withLeagueMember(request, context, async (actor) => {
    const view = await advisorFor(getDb(), actor.draftId, actor.userId);
    if (view === null) return fail("The advisor has nothing to call right now.", 409);
    return ok(view);
  });
}
