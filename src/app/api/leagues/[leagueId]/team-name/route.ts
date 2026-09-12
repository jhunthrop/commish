import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { renameMyTeam } from "@/league-service/settings";
import { renameMyTeamSchema } from "@/league-service/schemas";
import type { TeamNameBody } from "@/league-room/contract";
import { withLeagueActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A manager names their OWN team. No team id in the path and none in the body: the service's
 * `WHERE league_id AND user_id` is the whole authorization boundary, so this route cannot be
 * pointed at anybody else's seat however it is called, exactly the shape the slot-preference
 * route beside it keeps.
 *
 * `withLeagueActor`, not `withLeagueMemberActor`: the coarser gate's 403 would tell a stranger
 * that a league exists, and `renameMyTeam`'s own 404 already answers "no seat here" without the
 * oracle (ruling 14, the same reasoning the slot-preference route records).
 */
export async function PUT(request: Request, context: LeagueRouteContext) {
  return withLeagueActor(request, context, async (actor, req) => {
    const parsed = await parseJson(req, renameMyTeamSchema);
    if (!parsed.ok) return parsed.response;

    const result = await renameMyTeam(getDb(), { leagueId: actor.leagueId, userId: actor.userId, name: parsed.value.name });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<TeamNameBody>({ name: result.name });
  });
}
