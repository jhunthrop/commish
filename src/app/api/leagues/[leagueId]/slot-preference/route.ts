import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { setSlotPreference, setSlotPreferenceSchema } from "@/draft-service";
import { draftScheduleView } from "@/league-service";
import type { SlotPreferenceView } from "@/league-room/contract";
import { withLeagueActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shared by GET and PUT below: `draftScheduleView` already resolves the caller's own team and
 *  builds their `SlotPreferenceView` (`@/league-service/draft-schedule`) — a ranking is scoped
 *  to a team, so a caller with none here gets the SAME non-oracle 404 a stranger to the league
 *  entirely would, never a 403 (ruling 14, and the brief's own rule for this route). */
const NOT_FOUND = "That league does not exist.";

/**
 * NFFC's Kentucky Derby System. Own preferences only — this route never takes a team id, so a
 * caller can neither read nor write anybody's ranking but their own (a ranking is a preference
 * expressed privately; Plan A's notice-privacy reasoning applies to it whole). Built on
 * `withLeagueActor`, not `withLeagueMemberActor`: the 403 the latter gives a caller with no team
 * here would be an oracle-leaking exception to a route whose whole authorization boundary is
 * `draftScheduleView`'s / `setSlotPreference`'s own 404, so this route skips the coarser gate
 * entirely and lets the service answer.
 */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueActor(request, context, async (actor) => {
    const view = await draftScheduleView(getDb(), actor.leagueId, actor.userId);
    if (view === null || view.slotPreference === null) return fail(NOT_FOUND, 404);
    return ok<SlotPreferenceView>(view.slotPreference);
  });
}

/**
 * Saves the caller's own ranking. `setSlotPreference` (`@/draft-service/slot-preference`) is the
 * whole authorization and validation boundary — 404 for anyone with no team in this league, 409
 * once the draft has left `scheduled`, and 422 for a repeated or out-of-range slot number. This
 * route only parses the body and forwards the caller's session identity.
 */
export async function PUT(request: Request, context: LeagueRouteContext) {
  return withLeagueActor(request, context, async (actor, req) => {
    const parsed = await parseJson(req, setSlotPreferenceSchema);
    if (!parsed.ok) return parsed.response;

    const result = await setSlotPreference(getDb(), {
      leagueId: actor.leagueId,
      userId: actor.userId,
      ranking: parsed.value.ranking,
    });
    if (!result.ok) return fail(result.reason, result.status);

    const view = await draftScheduleView(getDb(), actor.leagueId, actor.userId);
    if (view === null || view.slotPreference === null) return fail(NOT_FOUND, 404);
    return ok<SlotPreferenceView>(view.slotPreference);
  });
}
