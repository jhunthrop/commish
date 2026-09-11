import type { PresenceBody } from "@/league-room/contract";
import { ok } from "@/lib/api/respond";
import { createPresenceStore } from "@/lib/realtime/presence";
import { getSharedRedis } from "@/lib/realtime/redis";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is in this league's room right now: the members holding a live stream open, as the
 * server itself recorded them (`src/lib/realtime/presence.ts`). Gated by the same membership
 * rule the stream is, so a stranger can neither watch the picks nor see who is watching them.
 * Ids only: the room already knows every member's name and face from its own read.
 */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor) => {
    const userIds = await createPresenceStore(getSharedRedis()).listPresent(actor.leagueId, Date.now());
    return ok<PresenceBody>({ userIds });
  });
}
