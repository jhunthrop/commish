import { getDb } from "@research/db/client";
import { markNoticesRead } from "@/integrity-service/notify";
import { markNoticesReadSchema } from "@/integrity-service/schemas";
import { ok, parseJson } from "@/lib/api/respond";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { noticesRateLimited } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const systemClock = { now: () => new Date().toISOString() };

interface MarkNoticesReadBody {
  readonly stamped: number;
}

/**
 * Marks a subset of the caller's OWN notices read, and answers exactly how many it stamped —
 * `markNoticesRead`'s own `WHERE userId = ...` is what makes an id belonging to someone else, or
 * one already read, both match zero rows rather than a 403 or a 404: the caller learns nothing
 * about whether an id they don't own even exists.
 */
export async function POST(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const limited = noticesRateLimited(userId);
    if (limited !== null) return limited;

    const parsed = await parseJson(req, markNoticesReadSchema);
    if (!parsed.ok) return parsed.response;

    const stamped = await markNoticesRead(getDb(), {
      userId,
      noticeIds: parsed.value.noticeIds,
      readAt: systemClock.now(),
    });
    return ok<MarkNoticesReadBody>({ stamped });
  });
}
