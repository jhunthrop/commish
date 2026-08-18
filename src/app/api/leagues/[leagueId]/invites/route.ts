import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { createInvite, createInviteSchema } from "@/league-service";
import type { InviteBody } from "@/league-room/contract";
import { withCommissioner, type LeagueRouteContext } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const systemClock = { now: () => new Date().toISOString() };

/** Commissioner-only: mint a shareable link + short code for this league. */
export async function POST(request: Request, context: LeagueRouteContext) {
  return withCommissioner(request, context, async (actor, req) => {
    const parsed = await parseJson(req, createInviteSchema);
    if (!parsed.ok) return parsed.response;

    const result = await createInvite(
      { db: getDb(), clock: systemClock, random: Math.random },
      { leagueId: actor.leagueId, createdByUserId: actor.userId, maxUses: parsed.value.maxUses },
    );
    if (!result.ok) return fail(result.reason, 503);
    return ok<InviteBody>({
      code: result.code,
      path: `/app/join/${result.code}`,
      expiresAt: result.expiresAt,
      maxUses: result.maxUses,
    });
  });
}
