import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { draftScheduleView, setDraftKickoff, setDraftKickoffSchema } from "@/league-service";
import type { DraftScheduleBody } from "@/league-room/contract";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The chosen draft time, and the draft's own state — the button Phase 1 built and nobody could
 * ever press on purpose (`POST /api/drafts/[draftId]/start`). Any league member may read it:
 * the schedule is what everybody in the league is planning around, not a commissioner-only fact
 * (same reasoning `LeagueHomeBody.terms` is never gated on `isCommissioner`).
 */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor) => {
    const view = await draftScheduleView(getDb(), actor.leagueId);
    if (view === null) return fail("That league doesn't exist.", 404);
    return ok<DraftScheduleBody>(view);
  });
}

/**
 * Moves the draft's kickoff. `setDraftKickoff` (`@/league-service/draft-schedule`) is the whole
 * authorization and validation boundary here — it answers 404 for anyone but the commissioner
 * (never 403: ruling 14's non-oracle discipline, so an ordinary member learns nothing about
 * whether they merely lack permission or the draft doesn't exist), 409 once the draft has left
 * `scheduled`, and 422 for a time that isn't genuinely in the future or sits past the clock
 * schedule's ceiling. This route only parses the body and forwards the caller's session identity
 * — `requireLeagueMember` (`withLeagueMemberActor`) still refuses a complete stranger with the
 * league's ordinary 403 before the service is ever asked.
 */
export async function PUT(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    const parsed = await parseJson(req, setDraftKickoffSchema);
    if (!parsed.ok) return parsed.response;

    const result = await setDraftKickoff(getDb(), {
      leagueId: actor.leagueId,
      userId: actor.userId,
      kickoffAt: parsed.value.kickoffAt,
    });
    if (!result.ok) return fail(result.reason, result.status);

    const view = await draftScheduleView(getDb(), actor.leagueId);
    if (view === null) return fail("That league doesn't exist.", 404);
    return ok<DraftScheduleBody>(view);
  });
}
