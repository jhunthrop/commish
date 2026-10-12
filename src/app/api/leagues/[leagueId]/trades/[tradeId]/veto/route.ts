import { getDb } from "@research-ts/db/client";
import { fail, ok } from "@/lib/api/respond";
import { processTradeReviews, vetoTrade } from "@/league-service/trade-review";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST: one member's veto vote on a trade under league review (roadmap item 5). The service
 * owns the rules — parties cannot vote, one vote each, the threshold settles immediately.
 */
export async function POST(request: Request, context: LeagueRouteContext & { readonly params: Promise<{ leagueId: string; tradeId: string }> }) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    await processTradeReviews(getDb());
    const { tradeId } = await (context.params as Promise<{ leagueId: string; tradeId: string }>);
    const result = await vetoTrade(getDb(), { leagueId: actor.leagueId, tradeId, userId: actor.userId });
    if (!result.ok) return fail(result.reason, result.status);
    return ok(result);
  });
}
