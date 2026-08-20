import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ok } from "@/lib/api/respond";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { crossLeagueHome } from "@/league-service";
import { getScoreCache } from "@/league-service/score-cache-instance";
import { readPreferences } from "@/identity-service/preferences";
import { firstRunPlan } from "@/identity";
import type { HomeBody } from "@/league-room/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The cross-league home's data, behind `requireCurrentUser` — `withCurrentUser` (shared with
 * every other `/api/leagues/**` route) is that gate: a 401 JSON envelope for a signed-out
 * caller, never a redirect, and the same error boundary every other gated route gets.
 *
 * `HomeBoard` (`@/league-room/components/home-board.tsx`) polls this on an interval, so it
 * answers the exact same `HomeBody` shape `AppHome` (`@/app/app/page.tsx`) server-renders —
 * one shape, whichever path produced it, `firstRun` included: this route computes it the same
 * way `AppHome` does, from the SAME two inputs (`readPreferences`, the caller's own league
 * count), rather than trusting `crossLeagueHome` to know about preferences it was never given.
 *
 * `withCurrentUser` only hands the handler a bare user id, so `experienceTier` is read directly
 * (one indexed column select) — the same targeted-select idiom `updatePreferences`
 * (`@/identity-service/preferences.ts`) already uses rather than pulling in the full
 * `getCurrentUser()` sync machinery a second time in the same request.
 */
export async function GET(request: Request) {
  return withCurrentUser(request, async (userId) => {
    const db = getDb();
    const [userRow] = await db.select({ experienceTier: users.experienceTier }).from(users).where(eq(users.id, userId));
    if (userRow === undefined) throw new Error(`No user row for id ${userId}.`);

    const [leaguesHome, preferences] = await Promise.all([
      crossLeagueHome(db, userId, { scoreCache: getScoreCache() }),
      readPreferences(db, { id: userId, experienceTier: userRow.experienceTier }),
    ]);
    const firstRun = firstRunPlan({
      experienceTier: userRow.experienceTier,
      helpLevel: preferences.helpLevel,
      leagueCount: leaguesHome.leagues.length,
    });

    return ok<HomeBody>({ ...leaguesHome, firstRun });
  });
}
