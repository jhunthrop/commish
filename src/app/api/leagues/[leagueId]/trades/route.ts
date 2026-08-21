import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";
import { listTrades, proposeTrade, type ProposeTradeResult } from "@/league-service/trades";
import { proposeTradeSchema } from "@/league-service/trade-schemas";
import type { TradesPageBody } from "@/trades/contract";
import { tradeRateLimited } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The three bands this league's trade page renders: offers to answer, offers sent, and the
 *  league's settled history — the caller's own team's inbox/outbox. */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor) => {
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);
    const page = await listTrades(getDb(), { leagueId: actor.leagueId, teamId: actor.teamId });
    return ok<TradesPageBody>(page);
  });
}

/** What a successful propose answers with the wire cares about: the new offer's id, and the
 *  proposer's own private, advisory fairness read on it. */
type ProposeTradeResponseBody = Extract<ProposeTradeResult, { readonly ok: true }>;

/**
 * Offer a trade. `withLeagueMemberActor` -> `actor.teamId === null` check -> `tradeRateLimited`
 * -> `await params` -> `parseJson` -> `proposeTrade` -> `fail`/`ok`, the fixed order every route
 * in this codebase uses.
 *
 * The proposing team is `actor.teamId`, resolved from the session by `withLeagueMemberActor` —
 * `proposeTrade` re-derives it itself from `actor.userId` (the service is the real boundary, not
 * only the route), but there is no field in `proposeTradeSchema` a body could spoof it through
 * either way. The request names only the COUNTERPARTY team and the assets.
 */
export async function POST(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);
    const limited = tradeRateLimited(actor.userId);
    if (limited !== null) return limited;

    const parsed = await parseJson(req, proposeTradeSchema);
    if (!parsed.ok) return parsed.response;

    const result = await proposeTrade(getDb(), {
      leagueId: actor.leagueId,
      userId: actor.userId,
      counterpartyTeamId: parsed.value.counterpartyTeamId,
      weekNumber: parsed.value.weekNumber,
      proposerAssets: parsed.value.proposerAssets,
      counterpartyAssets: parsed.value.counterpartyAssets,
      note: parsed.value.note,
    });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<ProposeTradeResponseBody>(result, { status: 201 });
  });
}
