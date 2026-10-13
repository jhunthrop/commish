import { getDb } from "@research-ts/db/client";
import { ok, parseJson } from "@/lib/api/respond";
import { setDraftGradesVisible, setDraftGradesVisibleSchema } from "@/league-service";
import type { LeagueSettingsBody } from "@/league-room/contract";
import { withCommissioner, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Commissioner-only: whether draft grades show on league home once the draft ends
 * (`leagues.draft_grades_visible`, Task 9's own column). `withCommissioner` is the whole
 * authorization boundary here — the same trust-the-route-scope shape `POST /api/leagues/
 * [leagueId]/invites` already uses for its own commissioner-only write, since
 * `setDraftGradesVisible` writes exactly the one league `withCommissioner` already scoped the
 * caller to. No 409 state-machine gate: unlike the draft's kickoff time, this toggle has no
 * "too late" moment, so the only possible refusal is the ordinary 403 a non-commissioner already
 * gets before this handler ever runs.
 */
export async function PUT(request: Request, context: LeagueRouteContext) {
  return withCommissioner(request, context, async (actor, req) => {
    const parsed = await parseJson(req, setDraftGradesVisibleSchema);
    if (!parsed.ok) return parsed.response;

    await setDraftGradesVisible(getDb(), { leagueId: actor.leagueId, visible: parsed.value.draftGradesVisible });
    return ok<LeagueSettingsBody>({ draftGradesVisible: parsed.value.draftGradesVisible });
  });
}
