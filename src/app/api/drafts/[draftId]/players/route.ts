import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { rankedPlayers } from "@/draft-service/pool";
import type { DraftPlayersBody } from "@/draft-room/contract";
import { withDraftActor, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Player metadata for the room's pool, in the same ranked order `START_DRAFT` snapshots.
 * Deliberately a second request instead of a field on `GET /api/drafts/[draftId]`: the draft
 * view is refetched on every gap and every reconnect, while this dictionary never changes
 * during a draft. It rides the same `withDraftActor` seam, so its authorization can never
 * drift from the state route's.
 */
export async function GET(request: Request, context: RouteContext) {
  return withDraftActor(request, context, async (actor) => {
    if (actor.teamId === null && !actor.isCommissioner) {
      return fail("You don't have a team in this league.", 403);
    }
    const body: DraftPlayersBody = { players: await rankedPlayers(getDb(), actor.leagueId) };
    return ok(body);
  });
}
