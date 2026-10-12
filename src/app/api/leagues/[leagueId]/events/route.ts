import { eq } from "drizzle-orm";
import { getDb } from "@research/db/client";
import { drafts } from "@/db/schema";
import { createPresenceStore, presenceLifecycle } from "@/lib/realtime/presence";
import { getPublisher } from "@/lib/realtime/publisher";
import { getSharedRedis } from "@/lib/realtime/redis";
import { getResyncMarker } from "@/lib/realtime/resync";
import { createLeagueEventStream } from "@/lib/realtime/sse";
import { withLeagueMemberActor, type LeagueRouteContext } from "../../_shared";

// SSE streams are long-lived; this route must run on the Node runtime, not the Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * The stream holds its function alive as long as the plan allows — the same ceiling
 * `/api/jobs/tick` already declares. It closes itself with a retry hint before this cap
 * (`REALTIME_CONFIG.plannedCloseMs`), so the browser's reconnect is planned rather than a
 * timeout.
 */
export const maxDuration = 300;

/**
 * The real-time fan-out, gated by the one league-membership rule every `/api/leagues/**`
 * route now shares (R-B5): a signed-in stranger with no team here — and who isn't the
 * commissioner — must not be able to watch another league's picks, chat and scores.
 *
 * THE STREAM RELAYS ONLY (draft-room performance round, items 1 and 3; the batched bots round).
 * This invocation used to be driver 2 of the draft-driver design: an advance loop that paced bot
 * picks and clock expiries while somebody watched, with the advisor's warm hung off it. Both are
 * gone from here. A mock's bot picks are committed in the batch behind the human action before
 * them (`@/draft-service/store`) and revealed by the room at their stamps; the facts are the
 * pick's own invocation's business. Nothing on this event loop is heavier than a frame — the one
 * read it adds is the resync mark on each keepalive (review finding 3), a single Redis GET.
 *
 * SIDELINE (P5): the connection is also the member's PRESENCE. Opening it marks them in the
 * room, every keepalive refreshes the mark, closing it marks them gone, and each edge publishes
 * `presence.changed` so every other open room re-reads who is here. Derived from the socket the
 * server holds, never from a client's claim, and never able to close the stream it rides.
 */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor) => {
    const lifecycle = presenceLifecycle(
      { store: createPresenceStore(getSharedRedis()), publish: (input) => getPublisher().publish(input), now: () => Date.now() },
      actor.leagueId,
      actor.userId,
    );
    const [draft] = await getDb().select({ id: drafts.id }).from(drafts).where(eq(drafts.leagueId, actor.leagueId));
    const resync = draft === undefined ? undefined : { leagueId: actor.leagueId, draftId: draft.id, check: (draftId: string) => getResyncMarker().check(draftId) };
    return createLeagueEventStream(request, actor.leagueId, actor.userId, { lifecycle, resync });
  });
}
