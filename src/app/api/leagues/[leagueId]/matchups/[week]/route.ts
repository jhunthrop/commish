import { getDb } from "@research/db/client";
import { fail, ok } from "@/lib/api/respond";
import { matchupWeek } from "@/league-service";
import { getReferenceCache } from "@/league-service/reference-cache-instance";
import type { MatchupWeekBody } from "@/league-room/contract";
import { withLeagueMemberActor } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string; readonly week: string }>;
}

/** One week's matchups, both lineups, and every per-player number the page renders. */
export async function GET(request: Request, context: RouteContext) {
  const { week } = await context.params;
  const weekNumber = Number.parseInt(week, 10);
  if (!Number.isInteger(weekNumber) || weekNumber < 1) return fail("That isn't a week we can show.", 400);

  return withLeagueMemberActor(request, { params: context.params }, async (actor) => {
    const body = await matchupWeek(getDb(), actor.leagueId, weekNumber, actor.userId, getReferenceCache());
    if (body === null) return fail("That league does not exist.", 404);
    return ok<MatchupWeekBody>(body);
  });
}
