import { z } from "zod";
import { getPublisher } from "@/lib/realtime/publisher";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/events";
import { fail, ok, parseJson } from "@/lib/api/respond";

/**
 * Development-only: lets a test harness publish an arbitrary event to a league stream
 * so the SSE endpoint can be checked end-to-end before any real feature publishes.
 * Hard-disabled outside development.
 *
 * The type enum reads `REALTIME_EVENT_TYPES` (`@/lib/realtime/events`) rather than restating
 * the taxonomy by hand, which is what ruling 21's single-source docblock asks for and what a
 * hand copy had already drifted from: it was missing `draft.queue` and `draft.nudge`, so the
 * dev harness could not publish two event types the product does publish.
 */
const Body = z.object({
  leagueId: z.string().min(1),
  type: z.enum(REALTIME_EVENT_TYPES),
  payload: z.unknown(),
});

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return fail("Not found.", 404);
  const parsed = await parseJson(request, Body);
  if (!parsed.ok) return parsed.response;
  const id = await getPublisher().publish(parsed.value);
  return ok({ id });
}
