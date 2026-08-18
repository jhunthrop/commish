import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import { lineupView, setLineup, setLineupSchema } from "@/league-service";
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
    const weekNumber = Number.parseInt(new URL(req.url).searchParams.get("week") ?? "1", 10);
    if (!Number.isInteger(weekNumber) || weekNumber < 1) return fail("That isn't a week we can show.", 400);

    const view = await lineupView(getDb(), { leagueId: actor.leagueId, teamId: actor.teamId, weekNumber });
    if (view === null) return fail("That league doesn't exist.", 404);
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
    });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<LineupBody>(result.lineup);
  });
}
