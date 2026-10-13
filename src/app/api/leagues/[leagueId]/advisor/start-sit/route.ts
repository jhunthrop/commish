import { assembleAdvisorContext, createStartSitAdvisor } from "@/ai-advisor";
import { startSitRequestSchema } from "@/ai-advisor/schemas";
import { getDb } from "@research-ts/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import { getLlmClient, isLLMEnabled } from "@/lib/llm/client";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";
import type { AdviceBody } from "@/league-room/contract";
import { advisorRateLimited } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start/sit advice for the CALLER's own team. There is no `teams/[teamId]` shape here for the
 * same reason the lineup route has none: the team comes from the session, so nobody can ask
 * for a read of somebody else's roster by changing a path segment.
 *
 * `isLLMEnabled()` is read here and nowhere deeper — the one edge where enablement is decided.
 */
export async function POST(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);
    const limited = advisorRateLimited(actor.userId);
    if (limited !== null) return limited;

    const parsed = await parseJson(req, startSitRequestSchema);
    if (!parsed.ok) return parsed.response;

    const advisorContext = await assembleAdvisorContext(getDb(), {
      leagueId: actor.leagueId,
      teamId: actor.teamId,
      weekNumber: parsed.value.weekNumber,
    });
    if (advisorContext === null) return fail("That league does not exist.", 404);

    const advise = createStartSitAdvisor({ enabled: isLLMEnabled(), llm: getLlmClient() });
    return ok<AdviceBody>(await advise({ context: advisorContext, question: parsed.value.question }));
  });
}
