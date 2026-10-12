import { getDb } from "@research-ts/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { acceptInvite, acceptInviteSchema } from "@/league-service";
import type { JoinBody } from "@/league-room/contract";
import { withCurrentUser } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const systemClock = { now: () => new Date().toISOString() };

interface RouteContext {
  readonly params: Promise<{ readonly code: string }>;
}

/** Join a league by invite code. Re-accepting your own invite is a success, not an error. */
export async function POST(request: Request, { params }: RouteContext) {
  return withCurrentUser(request, async (userId, req) => {
    const { code } = await params;
    const parsed = await parseJson(req, acceptInviteSchema);
    if (!parsed.ok) return parsed.response;

    const result = await acceptInvite(
      { db: getDb(), clock: systemClock, newId: () => crypto.randomUUID() },
      { code, userId, teamName: parsed.value.teamName },
    );
    if (!result.ok) return fail(result.reason, result.status);
    return ok<JoinBody>({ leagueId: result.leagueId, teamId: result.teamId, alreadyMember: result.alreadyMember });
  });
}
