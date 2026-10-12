import { getDb } from "@research/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import { lineupView, setLineup, setLineupSchema, weekNumberSchema } from "@/league-service";
import type { LineupBody } from "@/league-room/contract";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller's OWN lineup. `teams/me`, never `teams/[teamId]`: the acting team comes from the
 * session, so there is no path or body shape in which a manager sets somebody else's lineup.
 */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);
    // The same bound the PUT body is held to (`setLineupSchema.weekNumber`) — one week
    // boundary for the resource, not one per verb.
    const week = weekNumberSchema.safeParse(Number(new URL(req.url).searchParams.get("week") ?? "1"));
    if (!week.success) return fail("That isn't a week we can show.", 400);

    const view = await lineupView(getDb(), { leagueId: actor.leagueId, teamId: actor.teamId, weekNumber: week.data });
    if (view === null) return fail("That league does not exist.", 404);
    return ok<LineupBody>(view);
  });
}

export async function PUT(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);

    const parsed = await parseJson(req, setLineupSchema);
    if (!parsed.ok) return parsed.response;

    const result = await setLineup(getDb(), {
      leagueId: actor.leagueId,
      teamId: actor.teamId,
      weekNumber: parsed.value.weekNumber,
      slots: parsed.value.slots,
      userId: actor.userId,
    });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<LineupBody>(result.lineup);
  });
}
