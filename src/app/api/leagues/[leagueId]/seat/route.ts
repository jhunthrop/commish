import { getDb } from "@research-ts/db/client";
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
 * `releaseSeat` is ever asked — a caller with a team here always reaches the service. `releaseSeat`'s
 * own `RELEASE_REFUSALS.notMember` stays reachable regardless (P9 fix round, P8-L2 — corrected
 * from an earlier "structurally-unreachable" overclaim): a real, if narrow, window exists between
 * this route's own membership read and `releaseSeat`'s LOCKED one — two `DELETE` requests for the
 * same seat racing each other (a double-click, a retried request after a slow response) is the
 * plain, reachable case. Whichever request's transaction takes `leagues[X] FOR UPDATE` second
 * finds no team left to release and answers this refusal cleanly — a real, safely-handled race,
 * not a state nothing can ever reach.
 */
/**
 * P9 fix round, P8-L1: `commissioner: 403` follows `withCommissioner`'s own general convention
 * (`@/app/api/leagues/_shared.ts`, "Only the commissioner can do that.") — NOT ruling 14's
 * non-oracle 404 discipline. Ruling 14 exists to keep a caller from learning whether a resource
 * they cannot act on even EXISTS; a caller refused here already knows the fact being refused —
 * they are asking to leave a league they are already, verifiably, the commissioner of — so there
 * is nothing left for a 404 to hide, and 403 says the true thing plainly, the same way every other
 * `withCommissioner`-gated route in this codebase already does.
 */
/**
 * P9 fix round, P8-L4: an exhaustive `Record` over `RELEASE_REFUSALS`' own keys, compiler-nudged —
 * a fifth refusal added to that object without a matching entry here is a TYPE ERROR, not a
 * silent fall-through to whatever the last `if` in a chain happened to default to.
 */
const RELEASE_REFUSAL_STATUS: Readonly<Record<keyof typeof RELEASE_REFUSALS, number>> = {
  leagueMissing: 404,
  notMember: 404,
  commissioner: 403, // the general `withCommissioner` convention — see this function's own docblock.
  draftStarted: 409, // the seat this caller wants back no longer exists as a seat.
};

function statusFor(reason: string): number {
  const key = (Object.keys(RELEASE_REFUSALS) as (keyof typeof RELEASE_REFUSALS)[]).find((refusalKey) => RELEASE_REFUSALS[refusalKey] === reason);
  // `releaseSeat` only ever returns one of `RELEASE_REFUSALS`' own values in practice (its own
  // `ReleaseSeatResult` type is `reason: string`, not a literal union, so this is not
  // compiler-enforced end to end) — `key === undefined` is the defensive floor for that gap, never
  // a branch this route expects to actually reach.
  return key === undefined ? 500 : RELEASE_REFUSAL_STATUS[key];
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
