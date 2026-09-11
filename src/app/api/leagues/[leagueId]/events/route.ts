import { startDraftAdvanceLoopForLeague } from "@/draft-service";
import { draftEventSequence } from "@/draft-service/advance";
import { createPresenceStore, presenceLifecycle } from "@/lib/realtime/presence";
import { getPublisher } from "@/lib/realtime/publisher";
import { getSharedRedis } from "@/lib/realtime/redis";
import { createLeagueEventStream } from "@/lib/realtime/sse";
import { withLeagueMemberActor, type LeagueRouteContext } from "../../_shared";

// SSE streams are long-lived; this route must run on the Node runtime, not the Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Driver 2 of the draft-driver design (2026-09-03): while somebody watches, this invocation IS
 * the draft's ticker, so it holds its function alive as long as the plan allows — the same
 * ceiling `/api/jobs/tick` already declares. The stream closes itself with a retry hint before
 * this cap (`REALTIME_CONFIG.plannedCloseMs`), so the browser's reconnect is planned rather than
 * a timeout, and the fresh invocation picks the loop back up.
 */
export const maxDuration = 300;

/**
 * The real-time fan-out, gated by the one league-membership rule every `/api/leagues/**`
 * route now shares (R-B5): a signed-in stranger with no team here — and who isn't the
 * commissioner — must not be able to watch another league's picks, chat and scores.
 *
 * If this league's draft still has work to do soon, the connection also starts the draft
 * advance loop (`startDraftAdvanceLoopForLeague`): on Vercel no long-lived ticker exists, so
 * the watcher's own stream is what moves bot picks and clock expiries in real time.
 *
 * SIDELINE (P5): the connection is also the member's PRESENCE. Opening it marks them in the
 * room, every keepalive refreshes the mark, closing it marks them gone, and each edge publishes
 * `presence.changed` so every other open room re-reads who is here. Derived from the socket the
 * server holds, never from a client's claim, and never able to close the stream it rides.
 */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor) => {
    const loop = await startDraftAdvanceLoopForLeague(actor.leagueId, request.signal);
    const lifecycle = presenceLifecycle(
      { store: createPresenceStore(getSharedRedis()), publish: (input) => getPublisher().publish(input), now: () => Date.now() },
      actor.leagueId,
      actor.userId,
    );
    return createLeagueEventStream(request, actor.leagueId, actor.userId, {
      lifecycle,
      onEvent: (event) => {
        const sequence = draftEventSequence(event);
        if (sequence !== null) loop?.observe(sequence);
      },
    });
  });
}
