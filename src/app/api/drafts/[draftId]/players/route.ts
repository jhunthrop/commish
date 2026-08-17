import { getDb } from "@/db/client";
import { ok } from "@/lib/api/respond";
import { rankedPlayers } from "@/draft-service/pool";
import type { DraftPlayersBody } from "@/draft-room/contract";
import { withLeagueMember, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Player metadata for the room's pool, in the same ranked order `START_DRAFT` snapshots.
 * Deliberately a second request instead of a field on `GET /api/drafts/[draftId]`: the draft
 * view is refetched on every gap and every reconnect, while this dictionary never changes
 * during a draft. It rides the same `withLeagueMember` seam as the state route (both built
 * on `withDraftActor`), so its authorization can never drift from the state route's.
 */
export async function GET(request: Request, context: RouteContext) {
  return withLeagueMember(request, context, async (actor) => {
    const body: DraftPlayersBody = { players: await rankedPlayers(getDb(), actor.leagueId) };
    return ok(body);
  });
}
