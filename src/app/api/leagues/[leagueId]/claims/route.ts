import { z } from "zod";
import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import { claimPlayer, freeAgents } from "@/league-service/claims";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;

const claimSchema = z.object({
  addPlayerId: z.string().min(1),
  dropPlayerId: z.string().min(1).nullable().optional(),
});

/**
 * GET: the league's free agents — the pool minus every roster here, ADP-ordered, filterable by
 * name fragment and position. POST: the claim, add and drop in one transaction, first come
 * first served (see `claimPlayer`'s own docblock for where a waiver window would slot in).
 */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    const url = new URL(req.url);
    const rawPosition = url.searchParams.get("position") ?? "ALL";
    const position = (POSITIONS as readonly string[]).includes(rawPosition) ? (rawPosition as (typeof POSITIONS)[number]) : "ALL";
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);
    const result = await freeAgents(getDb(), {
      leagueId: actor.leagueId,
      search: url.searchParams.get("search") ?? undefined,
      position,
      offset,
    });
    return ok(result);
  });
}

export async function POST(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);
    const parsed = await parseJson(req, claimSchema);
    if (!parsed.ok) return parsed.response;

    const result = await claimPlayer(
      getDb(),
      {
        leagueId: actor.leagueId,
        userId: actor.userId,
        addPlayerId: parsed.value.addPlayerId,
        dropPlayerId: parsed.value.dropPlayerId ?? null,
      },
      { clock: { now: () => new Date().toISOString() } },
    );
    if (!result.ok) return fail(result.reason, result.status);
    return ok(result);
  });
}
