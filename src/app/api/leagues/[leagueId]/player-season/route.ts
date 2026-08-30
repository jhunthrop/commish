import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { playerSeason } from "@/league-service/player";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One player's season under THIS league's scoring rules — the same read the player page makes,
 * exposed for the bottom-sheet peek (founder, 2026-08-30: the name opens a drawer wherever it
 * appears, not a navigation). Same gate as the page: a member or the commissioner, and a
 * non-member learns nothing.
 */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    const playerId = new URL(req.url).searchParams.get("playerId") ?? "";
    if (playerId === "") return fail("Say which player.", 400);
    const body = await playerSeason(getDb(), actor.leagueId, playerId);
    if (body === null) return fail("No such player.", 404);
    return ok(body);
  });
}
