import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { RELEASE_REFUSALS, releaseSeat } from "@/league-service/release";
import { withLeagueMemberActor, type LeagueRouteContext } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The escape hatch the roll requires (Phase 3.6, Task 8): a member leaving a league whose draft
 * has not started. `releaseSeat` (`@/league-service/release`) is the whole authorization and
 * validation boundary — this route only forwards the caller's own session identity and maps its
 * plain `{ ok: false, reason }` back to an HTTP status, the same split `PUT
 * /api/leagues/[leagueId]/draft-schedule` already holds `setDraftKickoff` to.
 *
 * `withLeagueMemberActor` still refuses a complete stranger (403, `NO_TEAM_MESSAGE`) before
 * `releaseSeat` is ever asked — a caller with a team here always reaches the service, and its own
 * `RELEASE_REFUSALS.notMember` stays reachable only for the structurally-unreachable case of a
 * team that vanished between this route's membership read and the service's own, LOCKED one.
 */
function statusFor(reason: string): number {
  if (reason === RELEASE_REFUSALS.leagueMissing || reason === RELEASE_REFUSALS.notMember) return 404;
  if (reason === RELEASE_REFUSALS.commissioner) return 403;
  // RELEASE_REFUSALS.draftStarted — the seat this caller wants back no longer exists as a seat.
  return 409;
}

export interface ReleaseSeatBody {
  readonly released: true;
}

export async function DELETE(request: Request, context: LeagueRouteContext) {
  return withLeagueMemberActor(request, context, async (actor) => {
    const result = await releaseSeat(getDb(), { leagueId: actor.leagueId, userId: actor.userId });
    if (!result.ok) return fail(result.reason, statusFor(result.reason));
    return ok<ReleaseSeatBody>({ released: true });
  });
}
