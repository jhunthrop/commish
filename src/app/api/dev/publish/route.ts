import { z } from "zod";
import { getPublisher } from "@/lib/realtime/publisher";
import { fail, ok, parseJson } from "@/lib/api/respond";

/**
 * Development-only: lets a test harness publish an arbitrary event to a league stream
 * so the SSE endpoint can be verified end-to-end before any real feature publishes.
 * Hard-disabled outside development.
 */
const Body = z.object({
  leagueId: z.string().min(1),
  type: z.enum(["draft.pick", "draft.nominate", "draft.bid", "draft.timer_expire", "draft.status", "chat.message", "chat.reaction", "score.update"]),
  payload: z.unknown(),
});

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return fail("Not found.", 404);
  const parsed = await parseJson(request, Body);
  if (!parsed.ok) return parsed.response;
  const id = await getPublisher().publish(parsed.value);
  return ok({ id });
}
