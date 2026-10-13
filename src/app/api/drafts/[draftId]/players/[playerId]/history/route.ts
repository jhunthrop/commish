import { getDb } from "@research-ts/db/client";
import { ok } from "@/lib/api/respond";
import { playerHistory } from "@/draft-service/player-history";
import { withLeagueMember, type RouteContext } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** This route's own params: the shared draft context plus the player being peeked. */
interface HistoryRouteContext {
  readonly params: Promise<{ readonly draftId: string; readonly playerId: string }>;
}

/**
 * One player's real season history for the peek card (design ruling, 2026-09-02) — fetched
 * LAZILY when the peek opens and cached client-side per player for the room's lifetime, never
 * widened onto the players payload: it is per-player, historical, and most of the pool is never
 * peeked. Same `withLeagueMember` seam as every other `/api/drafts/[draftId]/**` read, so its
 * authorization can never drift from the room's. An unknown or uncrosswalked player answers
 * with an EMPTY body, not an error — absence is a fact the card renders as fewer rows.
 */
export async function GET(request: Request, context: HistoryRouteContext) {
  return withLeagueMember(request, context satisfies RouteContext, async (actor) => {
    const { playerId } = await context.params;
    return ok(await playerHistory(getDb(), actor.leagueId, playerId));
  });
}
