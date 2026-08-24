import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { clientQueueSchema } from "@/draft-engine";
import { getDraftStore, getTeamQueue, setTeamQueue } from "@/draft-service";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import type { DraftQueueBody } from "@/draft-room/contract";
import { withDraftActor, withLeagueMember, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The outermost edge is the only place a wall clock is allowed. */
const systemClock = { now: () => new Date().toISOString() };

/**
 * The caller's OWN autopick queue. A commissioner without a team of their own has none, so
 * they get an empty list rather than a 403 — they can still watch the room.
 */
export async function GET(request: Request, context: RouteContext) {
  return withLeagueMember(request, context, async (actor) => {
    if (actor.teamId === null) return ok<DraftQueueBody>({ queue: [] });
    const queue = await getTeamQueue(getDraftStore(), actor.draftId, actor.teamId);
    if (queue === null) return fail("That draft does not exist.", 404);
    return ok<DraftQueueBody>({ queue });
  });
}

/**
 * Replaces the caller's own queue. The acting team is resolved from the session — the body
 * schema has no `teamId`, so a client cannot queue players for somebody else.
 */
export async function POST(request: Request, context: RouteContext) {
  return withDraftActor(request, context, async (actor, req) => {
    // The same shared literal `POST /actions` uses — acting requires a real team.
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);

    const parsed = await parseJson(req, clientQueueSchema);
    if (!parsed.ok) return parsed.response;

    const result = await setTeamQueue(
      { db: getDb(), store: getDraftStore(), clock: systemClock },
      { draftId: actor.draftId, teamId: actor.teamId, playerIds: parsed.value.playerIds },
    );
    if (!result.ok) return fail(result.reason, 409);
    return ok<DraftQueueBody>({ queue: result.queue });
  });
}
