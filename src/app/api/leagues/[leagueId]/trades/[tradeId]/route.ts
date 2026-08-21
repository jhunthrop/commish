import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import { withLeagueMemberActor } from "@/app/api/leagues/_shared";
import { rejectTrade, withdrawTrade } from "@/league-service/trades";
import { tradeDecisionSchema } from "@/league-service/trade-schemas";
import { tradeRateLimited } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string; readonly tradeId: string }>;
}

/**
 * Answer an offer: accept, reject or withdraw, dispatched by `action` with no string comparison
 * of our own beyond the schema's — `tradeDecisionSchema` is the discriminated union.
 *
 * `accept` is Task 5's: `acceptTrade` does not exist yet, and this route refuses that arm with a
 * clean, product-copy 501 rather than a broken reference. Tasks 4 and 5 land before this plan
 * merges, so no release ever ships with `accept` unreachable — this line is the seam Task 5 wires
 * a real call into.
 *
 * `withLeagueMemberActor` -> `actor.teamId === null` check -> `tradeRateLimited` -> `await params`
 * -> `parseJson` -> the matching service call -> `fail`/`ok`, the same fixed order every route in
 * this codebase uses. `userId` is `actor.userId`, from the session — `rejectTrade`/`withdrawTrade`
 * both re-derive the caller's own team from it rather than trusting a body to name one.
 */
export async function POST(request: Request, context: RouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);
    const limited = tradeRateLimited(actor.userId);
    if (limited !== null) return limited;

    const { tradeId } = await context.params;
    const parsed = await parseJson(req, tradeDecisionSchema);
    if (!parsed.ok) return parsed.response;

    if (parsed.value.action === "accept") {
      return fail("Accepting a trade isn't available in this league yet. Check back soon.", 501);
    }

    const settle = parsed.value.action === "reject" ? rejectTrade : withdrawTrade;
    const result = await settle(getDb(), { tradeId, userId: actor.userId });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<{ readonly tradeId: string; readonly status: typeof result.status }>({ tradeId: result.tradeId, status: result.status });
  });
}
