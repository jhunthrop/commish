import { getCurrentUser } from "@/lib/auth/current-user";
import { createLeagueEventStream } from "@/lib/realtime/sse";
import { fail } from "@/lib/api/respond";

// SSE streams are long-lived; this route must run on the Node runtime, not the Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  const { leagueId } = await params;
  // League-membership authorization lands with the league service in Step 7;
  // until then any signed-in user may subscribe.
  return createLeagueEventStream(request, leagueId);
}
