import { assembleAdvisorContext, createTradeAnalyzer } from "@/ai-advisor";
import { tradeRequestSchema } from "@/ai-advisor/schemas";
import { getDb } from "@research/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import { getLlmClient, isLLMEnabled } from "@/lib/llm/client";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";
import type { TradeAssessmentBody } from "@/league-room/contract";
import { advisorRateLimited } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Assess a proposed trade. **This route never executes one** — there is no accept path, nothing
 * is written, and no proposal is stored. It answers a question and stops, which is a legal
 * constraint (strategy doc §4.2) enforced in code by `advisory-only.test.ts`.
 *
 * Both rosters are assembled through `assembleAdvisorContext` scoped to THIS league, so a
 * player id from another league is simply absent from either side's roster — `createTradeAnalyzer`
 * treats that the same as any other unrecognized id and refuses to invent a verdict (422), it
 * never gets valued.
 */
export async function POST(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);
    const limited = advisorRateLimited(actor.userId);
    if (limited !== null) return limited;

    const parsed = await parseJson(req, tradeRequestSchema);
    if (!parsed.ok) return parsed.response;

    const db = getDb();
    const mine = await assembleAdvisorContext(db, {
      leagueId: actor.leagueId,
      teamId: actor.teamId,
      weekNumber: parsed.value.weekNumber,
    });
    if (mine === null) return fail("That league does not exist.", 404);

    // The counterparty's roster is assembled the same way, through the same read-only path.
    const theirs = await assembleAdvisorContext(db, {
      leagueId: actor.leagueId,
      teamId: parsed.value.counterpartyTeamId,
      weekNumber: parsed.value.weekNumber,
    });
    if (theirs === null || theirs.me.players.length === 0 || parsed.value.counterpartyTeamId === actor.teamId) {
      return fail("We could not find that team in this league.", 404);
    }

    const analyze = createTradeAnalyzer({ enabled: isLLMEnabled(), llm: getLlmClient() });
    const assessment = await analyze({
      context: mine,
      opponent: theirs.me,
      proposal: {
        leagueId: actor.leagueId,
        weekNumber: parsed.value.weekNumber,
        from: { teamId: actor.teamId, playerIds: parsed.value.give },
        to: { teamId: parsed.value.counterpartyTeamId, playerIds: parsed.value.receive },
      },
    });
    if (assessment === null) {
      return fail("We couldn't read that trade. Check that both sides name players those teams actually have.", 422);
    }
    return ok<TradeAssessmentBody>(assessment);
  });
}
