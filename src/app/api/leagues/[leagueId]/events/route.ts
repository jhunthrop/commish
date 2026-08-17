import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveLeagueMembership } from "@/lib/leagues/membership";
import { createLeagueEventStream } from "@/lib/realtime/sse";
import { fail } from "@/lib/api/respond";

// SSE streams are long-lived; this route must run on the Node runtime, not the Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string }>;
}

/**
 * Gated the same way the draft board is (R-B5): a signed-in stranger with no team in this
 * league — and who isn't its commissioner — must not be able to subscribe to its stream and
 * watch picks, chat and scores land in another league's room.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  const { leagueId } = await params;

  const membership = await resolveLeagueMembership(getDb(), leagueId, user.id);
  if (!membership.ok) return fail(membership.error, membership.status);
  if (membership.membership.teamId === null && !membership.membership.isCommissioner) {
    return fail("You don't have a team in this league.", 403);
  }

  return createLeagueEventStream(request, leagueId);
}
