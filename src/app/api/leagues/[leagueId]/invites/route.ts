import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { createInvite, createInviteSchema } from "@/league-service";
import type { InviteBody } from "@/league-room/contract";
import { withCommissioner, type LeagueRouteContext } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const systemClock = { now: () => new Date().toISOString() };

// Invite codes are membership capabilities, so their randomness must be unpredictable.
// Math.random is seedable/observable; this derives a [0,1) float from crypto instead.
function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
}

/** Commissioner-only: mint a shareable link + short code for this league. */
export async function POST(request: Request, context: LeagueRouteContext) {
  return withCommissioner(request, context, async (actor, req) => {
    const parsed = await parseJson(req, createInviteSchema);
    if (!parsed.ok) return parsed.response;

    const result = await createInvite(
      { db: getDb(), clock: systemClock, random: cryptoRandom },
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
