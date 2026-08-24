import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { leagueHome } from "@/league-service";
import type { LeagueHomeBody } from "@/league-room/contract";
import { withLeagueMemberActor, type LeagueRouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Standings, this week's matchup, the roster shape and the draft's state, in one payload. */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor) => {
    const home = await leagueHome(getDb(), actor.leagueId, actor.userId);
    if (home === null) return fail("That league does not exist.", 404);
    return ok<LeagueHomeBody>(home);
  });
}
