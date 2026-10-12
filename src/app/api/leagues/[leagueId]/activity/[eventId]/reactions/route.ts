import { reactionSchema } from "@/chat-service";
import { getDb } from "@research-ts/db/client";
import { toggleEventReaction } from "@/league-service/event-reactions";
import { streamEventIdSchema } from "@/league-service/schemas";
import type { EventReactionBody } from "@/league-room/contract";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { getPublisher } from "@/lib/realtime/publisher";
import { withLeagueMemberActor } from "@/app/api/leagues/_shared";
import { reactionRateLimited } from "@/app/api/leagues/_reaction-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface StreamEventRouteContext {
  readonly params: Promise<{ readonly leagueId: string; readonly eventId: string }>;
}

/**
 * Toggle the caller's own reaction to something that happened in this league — a pick, a claim, a
 * trade. One verb for both directions, for the identical reason the message route gives: the
 * triple (event, user, emoji) either exists or it does not, so there is no separate un-react.
 *
 * MEMBERSHIP IS THE WHOLE GATE. Anyone with a seat in this league may react to any of its events,
 * including their own — a manager laughing at their own pick is the room working, not an edge
 * case to refuse. The service re-reads the event scoped to the league, so a member of one league
 * still cannot reach another league's event by guessing an id.
 *
 * The body schema is `reactionSchema` itself (`@/chat-service`), not a copy: the stream wears the
 * same closed five as the messages, and one closed set means one place it is validated.
 */
export async function POST(request: Request, context: StreamEventRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    const { eventId } = await context.params;
    const id = streamEventIdSchema.safeParse(eventId);
    if (!id.success) return fail(`eventId: ${id.error.issues[0]?.message ?? "That is not something we can react to."}`, 400);

    const limited = await reactionRateLimited(actor.userId);
    if (limited !== null) return limited;

    const parsed = await parseJson(req, reactionSchema);
    if (!parsed.ok) return parsed.response;

    const result = await toggleEventReaction(getDb(), {
      leagueId: actor.leagueId,
      eventId: id.data,
      userId: actor.userId,
      emoji: parsed.value.emoji,
      publish: (input) => getPublisher().publish(input),
    });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<EventReactionBody>({ eventId: id.data, action: result.action });
  });
}
