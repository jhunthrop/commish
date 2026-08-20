import { createUserEventStream } from "@/lib/realtime/sse";
import { withCurrentUser } from "@/app/api/leagues/_shared";

// SSE streams are long-lived; this route must run on the Node runtime, not the Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The real-time half of the inbox: `notice.created` frames on the caller's OWN stream key
 * (`REALTIME_CONFIG.userStreamKey`), never another user's. `withCurrentUser` is the same JSON
 * 401 (never a redirect) every other `/api/leagues/**` route shares — there is no parameter
 * anywhere in this route naming a user id; the only user id involved is the signed-in caller's,
 * read from their own session, exactly like `GET /api/notices` and `POST /api/notices/read`.
 */
export async function GET(request: Request) {
  return withCurrentUser(request, async (userId, req) => createUserEventStream(req, userId));
}
