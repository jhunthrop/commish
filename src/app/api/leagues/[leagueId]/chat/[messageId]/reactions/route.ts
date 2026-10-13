import { chatMessageIdSchema, reactionSchema, toggleReaction } from "@/chat-service";
import type { ReactionBody } from "@/chat/contract";
import { getDb } from "@research-ts/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { getPublisher } from "@/lib/realtime/publisher";
import { withLeagueMemberActor } from "@/app/api/leagues/_shared";
import { reactionRateLimited } from "@/app/api/leagues/_reaction-limit";

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
    // A path param is untrusted input like any other, and this one reaches a bigint comparison
    // as `Number(messageId)`. Validated HERE, before the service touches the database, so a
    // malformed id is a 400 naming the param — the same answer shape `parseJson` gives a bad
    // body — instead of a driver error surfacing as a generic 500.
    const id = chatMessageIdSchema.safeParse(messageId);
    if (!id.success) return fail(`messageId: ${id.error.issues[0]?.message ?? "That isn't a message id."}`, 400);

    // The SAME per-user budget the stream's own reactions spend from — see
    // `_reaction-limit.ts`: one act, one ceiling, so neither route is a detour around the other.
    const limited = await reactionRateLimited(actor.userId);
    if (limited !== null) return limited;

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
    return ok<ReactionBody>({ messageId, action: result.action });
  });
}
