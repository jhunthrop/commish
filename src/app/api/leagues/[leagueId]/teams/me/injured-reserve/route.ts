import { z } from "zod";
import { getDb } from "@research/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { activateFromInjuredReserve, placeOnInjuredReserve } from "@/league-service/injured-reserve";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const irSchema = z.object({
  playerId: z.string().min(1),
  action: z.enum(["place", "activate"]),
});

/**
 * POST: move a player onto or off this manager's injured reserve (roadmap item 3, 2026-08-30).
 * The service owns every rule — designation eligibility, the one-spot cap, the room check on
 * activation — and its refusals return verbatim.
 */
export async function POST(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    const parsed = await parseJson(req, irSchema);
    if (!parsed.ok) return parsed.response;
    const input = { leagueId: actor.leagueId, userId: actor.userId, playerId: parsed.value.playerId };
    const result =
      parsed.value.action === "place"
        ? await placeOnInjuredReserve(getDb(), input)
        : await activateFromInjuredReserve(getDb(), input);
    if (!result.ok) return fail(result.reason, result.status);
    return ok({ done: true });
  });
}
