import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { createLeague, createLeagueSchema, listLeaguesForUser } from "@/league-service";
import type { CreateLeagueBody, LeagueListBody } from "@/league-room/contract";
import { withCurrentUser } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The outermost edge is the only place a wall clock or a random id is allowed. */
const systemClock = { now: () => new Date().toISOString() };

export async function GET(request: Request) {
  return withCurrentUser(request, async (userId) =>
    ok<LeagueListBody>({ leagues: await listLeaguesForUser(getDb(), userId) }),
  );
}

/**
 * Create a league. Every field but the name has a default, so `{ "name": "…" }` is a complete
 * request — that is what makes the whole flow finishable in a handful of interactions.
 */
export async function POST(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const parsed = await parseJson(req, createLeagueSchema);
    if (!parsed.ok) return parsed.response;
    const user = await requireCurrentUser();

    const result = await createLeague(
      { db: getDb(), clock: systemClock, newId: () => crypto.randomUUID() },
      {
        ...parsed.value,
        auctionBudget: parsed.value.format === "auction" ? parsed.value.auctionBudget : null,
        rosterSlots: STANDARD_ROSTER_SLOTS,
        commissionerUserId: userId,
        teamName: parsed.value.teamName ?? `${user.displayName}'s team`,
        experienceTier: parsed.value.experienceTier ?? user.experienceTier,
        stakeTier: parsed.value.stakeTier,
        isPublicMatchmade: parsed.value.visibility === "public",
      },
    );
    if (!result.ok) return fail(result.reason, 500);
    return ok<CreateLeagueBody>(
      { leagueId: result.leagueId, teamId: result.teamId, draftId: result.draftId },
      { status: 201 },
    );
  });
}
