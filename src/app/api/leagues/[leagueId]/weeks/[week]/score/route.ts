import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { scoreWeek } from "@/league-service";
import { withCommissioner } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string; readonly week: string }>;
}

/**
 * Commissioner-only: score a week from the mock dataset. Explicit rather than scheduled,
 * because Phase 1 has no live feed — the dataset is static and a week is final the moment
 * somebody asks for it. Deliberately publishes no realtime event.
 */
export async function POST(request: Request, context: RouteContext) {
  const { week } = await context.params;
  const weekNumber = Number.parseInt(week, 10);
  if (!Number.isInteger(weekNumber) || weekNumber < 1) return fail("That isn't a week we can score.", 400);

  return withCommissioner(request, { params: context.params }, async (actor) => {
    const result = await scoreWeek(getDb(), actor.leagueId, weekNumber);
    if (!result.ok) return fail(result.reason, result.status);
    return ok({ weekNumber: result.weekNumber, matchupsScored: result.matchupsScored });
  });
}
