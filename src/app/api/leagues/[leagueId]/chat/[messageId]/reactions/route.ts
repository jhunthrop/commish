import { reactionSchema, toggleReaction } from "@/chat-service";
import type { ReactionBody } from "@/chat/contract";
import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { getPublisher } from "@/lib/realtime/publisher";
import { withLeagueMemberActor } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ChatMessageRouteContext {
  readonly params: Promise<{ readonly leagueId: string; readonly messageId: string }>;
}

/**
 * Toggle the caller's own reaction. One verb for both directions: a reaction has no separate
 * "un-react" endpoint because it has no separate state — the pair (message, user, emoji)
 * either exists or it doesn't.
 */
export async function POST(request: Request, context: ChatMessageRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    const { messageId } = await context.params;
    const parsed = await parseJson(req, reactionSchema);
    if (!parsed.ok) return parsed.response;

    const result = await toggleReaction(getDb(), {
      leagueId: actor.leagueId,
      messageId,
      userId: actor.userId,
      emoji: parsed.value.emoji,
      publish: (input) => getPublisher().publish(input),
    });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<ReactionBody>({ messageId, reactions: result.reactions });
  });
}
