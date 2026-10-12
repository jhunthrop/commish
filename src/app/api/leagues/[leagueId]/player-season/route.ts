import { getDb } from "@research/db/client";
import { fail, ok } from "@/lib/api/respond";
import { parseSeasonParam, playerSeason } from "@/league-service/player";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One player's season under THIS league's scoring rules — the same read the player page makes,
 * exposed for the bottom-sheet peek (founder, 2026-08-30: the name opens a drawer wherever it
 * appears, not a navigation). Same gate as the page: a member or the commissioner, and a
 * non-member learns nothing.
 *
 * `season` (2026-09-04 widening) is optional: absent, it answers for `playerSeason`'s own default
 * (the newest season with data for him), and the response's own `season`/`availableSeasons` tell
 * the caller which one that was and what else it could ask for. A season the query string names
 * that is not one of his available seasons is silently ignored in favour of that default, rather
 * than erroring — the same "fall back, never fabricate" rule the service itself keeps.
 */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    const params = new URL(req.url).searchParams;
    const playerId = params.get("playerId") ?? "";
    if (playerId === "") return fail("Say which player.", 400);
    const season = parseSeasonParam(params.get("season"));
    // The reader is threaded through so the body can say what the manager who HOLDS him is to
    // this manager (P6: your rival is always in the frame). The peek and the full page are the
    // same body and must answer the same way, so both pass it.
    const body = await playerSeason(getDb(), actor.leagueId, playerId, undefined, season, actor.userId);
    if (body === null) return fail("No such player.", 404);
    return ok(body);
  });
}
