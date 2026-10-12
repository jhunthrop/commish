import { getDb } from "@research-ts/db/client";
import { fail, ok } from "@/lib/api/respond";
import { leagueModerationSummary } from "@/integrity-service/flags";
import type { ModerationSummaryView } from "@/league-room/contract";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The commissioner's own window onto platform moderation in their league (Plan B's Task 6
 * persona-panel MEDIUM, ruled into Plan D's scope by name — see `leagueModerationSummary`'s own
 * docblock, `@/integrity-service/flags`). `withLeagueMemberActor` refuses a complete stranger
 * with the league's ordinary 403 before this ever runs; `leagueModerationSummary` itself is the
 * REAL boundary, answering `null` for a signed-in league member who is not its commissioner —
 * the identical no-oracle shape `GET /api/leagues/[leagueId]/draft-schedule`'s own `PUT` already
 * holds to for a commissioner-only write. A 404 here says nothing about WHY: not "you're not the
 * commissioner", just "not found", so an ordinary member learns nothing about the league's own
 * moderation history from the shape of the refusal.
 */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor) => {
    const summary = await leagueModerationSummary(getDb(), { leagueId: actor.leagueId, userId: actor.userId });
    if (summary === null) return fail("That league does not exist.", 404);
    return ok<ModerationSummaryView>(summary);
  });
}
