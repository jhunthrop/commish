import { getDb } from "@research/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import { withLeagueMemberActor } from "@/app/api/leagues/_shared";
import { acceptTrade, rejectTrade, withdrawTrade } from "@/league-service/trades";
import { getScoreCache } from "@/league-service/score-cache-instance";
import { tradeDecisionSchema } from "@/league-service/trade-schemas";
import { tradeRateLimited } from "../_shared";
import { processTradeReviews } from "@/league-service/trade-review";
import { getDb as getDbForReviews } from "@research/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string; readonly tradeId: string }>;
}

/**
 * Answer an offer: accept, reject or withdraw, dispatched by `action` with no string comparison
 * of our own beyond the schema's — `tradeDecisionSchema` is the discriminated union.
 *
 * `accept` is Task 5's own wiring: `acceptTrade` runs the whole execution transaction (both
 * rosters move, the supersede sweep settles every offer it just invalidated, both parties are
 * told) and passes the real `getScoreCache()` (`@/league-service/score-cache-instance`) — the
 * same live cache `crossLeagueHome`'s own read path uses — rather than the no-op default a test
 * relies on.
 *
 * `withLeagueMemberActor` -> `actor.teamId === null` check -> `tradeRateLimited` -> `await params`
 * -> `parseJson` -> the matching service call -> `fail`/`ok`, the same fixed order every route in
 * this codebase uses. `userId` is `actor.userId`, from the session — every service call below
 * re-derives the caller's own team from it rather than trusting a body to name one.
 *
 * `leagueId` is `actor.leagueId`, from the URL — never trusted as authorization on its own, but
 * REQUIRED so a `tradeId` borrowed from another league 404s rather than being found and acted on
 * because the caller happens to also field a team in that other league (`SettleTradeInput`'s own
 * docblock, `@/league-service/trades`).
 */
export async function POST(request: Request, context: RouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    await processTradeReviews(getDbForReviews());
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);
    const limited = tradeRateLimited(actor.userId);
    if (limited !== null) return limited;

    const { tradeId } = await context.params;
    const parsed = await parseJson(req, tradeDecisionSchema);
    if (!parsed.ok) return parsed.response;

    if (parsed.value.action === "accept") {
      const result = await acceptTrade(getDb(), { tradeId, leagueId: actor.leagueId, userId: actor.userId, cache: getScoreCache() });
      if (!result.ok) return fail(result.reason, result.status);
      // Plan D, Task 5: `outcome` tells "executed" and "held" apart, and the wire status says
      // which honestly — a manager who accepted a trade that then held is not looking at an
      // accepted offer, and `TradeStatus` (`@/trades/lifecycle`) already has the word for it.
      const status = result.outcome === "held" ? "held" : result.outcome === "under_review" ? "under_review" : "accepted";
      return ok<{ readonly tradeId: string; readonly status: "accepted" | "held" | "under_review" }>({ tradeId: result.tradeId, status });
    }

    const settle = parsed.value.action === "reject" ? rejectTrade : withdrawTrade;
    const result = await settle(getDb(), { tradeId, leagueId: actor.leagueId, userId: actor.userId });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<{ readonly tradeId: string; readonly status: typeof result.status }>({ tradeId: result.tradeId, status: result.status });
  });
}
