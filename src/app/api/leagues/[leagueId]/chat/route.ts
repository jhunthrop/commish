import { chatCursorSchema, listMessages, postMessage, postMessageSchema } from "@/chat-service";
import type { ChatPageBody, PostChatBody } from "@/chat/contract";
import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { getPublisher } from "@/lib/realtime/publisher";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One page of this league's chat, gated by the same membership rule the league's SSE stream
 * uses — the live channel and the history it catches up on must never disagree about who is
 * allowed to read them.
 */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    const raw = new URL(req.url).searchParams.get("before");
    if (raw !== null && !chatCursorSchema.safeParse(raw).success) {
      return fail("That isn't a place we can load from.", 400);
    }
    const page = await listMessages(getDb(), { leagueId: actor.leagueId, before: raw ?? undefined });
    return ok<ChatPageBody>({
      leagueId: actor.leagueId,
      meUserId: actor.userId,
      messages: page.messages,
      hasMore: page.hasMore,
    });
  });
}

/**
 * Say something. The author is `actor.userId` — resolved from the session by
 * `withLeagueMemberActor` — so no request body can put words in somebody else's mouth.
 */
export async function POST(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    const parsed = await parseJson(req, postMessageSchema);
    if (!parsed.ok) return parsed.response;

    const message = await postMessage(getDb(), {
      leagueId: actor.leagueId,
      userId: actor.userId,
      body: parsed.value.body,
      publish: (input) => getPublisher().publish(input),
    });
    return ok<PostChatBody>({ message }, { status: 201 });
  });
}
