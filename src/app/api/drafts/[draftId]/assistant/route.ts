import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { assistantCall } from "@/draft-service/assistant/call";
import { withLeagueMember, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE CALL — the live room's Assistant. `withLeagueMember` refuses a stranger with 403 before this
 * ever runs (the room's own membership gate, shared with the state and players routes); a member
 * with no seat of their own (a commissioner) or a draft not currently `in_progress` has nothing to
 * be advised about, which `assistantCall` answers with `null` — an honest 409 rather than a 200
 * carrying a shape the caller cannot use. A mock room is a draft like any other here: it rides the
 * identical `withLeagueMember` guard and `assistantCall`'s own state-load seam, so a practice
 * room's Assistant needs no route of its own.
 */
export async function GET(request: Request, context: RouteContext) {
  return withLeagueMember(request, context, async (actor) => {
    const view = await assistantCall(getDb(), actor.draftId, actor.userId);
    if (view === null) return fail("The assistant has nothing to call right now.", 409);
    return ok(view);
  });
}
