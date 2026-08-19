import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { joinPublicLeague } from "@/league-service/join";
import type { JoinBody } from "@/league-room/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string }>;
}

/**
 * Joining is where public browse stops being public: READING the open-league list needs no
 * account, but taking a seat in a league is an identity-bearing act, so this half goes through
 * `withCurrentUser` like every other write in the app. `teamId` and the owning user are
 * resolved from the session; no body field can name somebody else.
 *
 * `withLeagueMemberActor` is deliberately NOT used — its whole job is to reject a signed-in
 * stranger with no team, and a signed-in stranger with no team is exactly who this route is
 * for. The membership rules that DO apply (listed, pre-draft, not full) live in
 * `joinPublicLeague`, beside the lock that makes them true under concurrency.
 */
export async function POST(request: Request, { params }: RouteContext) {
  return withCurrentUser(request, async (userId) => {
    const { leagueId } = await params;
    const result = await joinPublicLeague(
      { db: getDb(), newId: () => crypto.randomUUID() },
      { leagueId, userId },
    );
    if (!result.ok) return fail(result.reason, result.status);
    return ok<JoinBody>({ leagueId: result.leagueId, teamId: result.teamId, alreadyMember: result.alreadyMember });
  });
}
