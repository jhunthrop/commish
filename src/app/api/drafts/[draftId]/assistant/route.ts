import { CAPSULE_CONFIG } from "@/capsules/config";
import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { envOrUndefined } from "@/lib/env";
import { advisorFor } from "@/draft-service/assistant/service";
import { withLeagueMember, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE ADVISOR — the live room's strategist (`docs/superpowers/specs/2026-09-07-draft-advisor-
 * design.md`). `withLeagueMember` refuses a stranger with 403 before this ever runs; a member
 * with no seat of their own (a commissioner) or a draft not currently `in_progress` has nothing
 * to be advised about, which `advisorFor` answers with `null` — an honest 409 rather than a 200
 * carrying a shape the caller cannot use. A mock room is a draft like any other here.
 *
 * The writer's key is read here, at the route edge, never inside the advisor's own modules; a
 * missing key means the template floor shows and nothing else changes.
 */
export async function GET(request: Request, context: RouteContext) {
  return withLeagueMember(request, context, async (actor) => {
    const apiKey = envOrUndefined(CAPSULE_CONFIG.gateway.envVars.apiKey);
    const view = await advisorFor(getDb(), actor.draftId, actor.userId, { voice: apiKey === undefined ? null : { apiKey } });
    if (view === null) return fail("The advisor has nothing to call right now.", 409);
    return ok(view);
  });
}
