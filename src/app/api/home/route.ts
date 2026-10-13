import { getDb } from "@research-ts/db/client";
import { ok } from "@/lib/api/respond";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { crossLeagueHome } from "@/league-service";
import { getScoreCache } from "@/league-service/score-cache-instance";
import type { HomeBody } from "@/league-room/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The cross-league home's data, behind `requireCurrentUser` — `withCurrentUser` (shared with
 * every other `/api/leagues/**` route) is that gate: a 401 JSON envelope for a signed-out
 * caller, never a redirect, and the same error boundary every other gated route gets.
 *
 * `HomeBoard` (`@/league-room/components/home-board.tsx`) polls this on an interval, so it
 * answers the exact same `HomeBody` shape `AppHome` (`@/app/app/(shell)/page.tsx`) server-renders.
 * One shape, one read, whichever path produced it: the first-run fork both callers used to
 * compute and spread on here is deleted with the panels it chose between (2026-09-11), which also
 * took this route's preferences read and its `users` lookup with it.
 */
export async function GET(request: Request) {
  return withCurrentUser(request, async (userId) => {
    return ok<HomeBody>(await crossLeagueHome(getDb(), userId, { scoreCache: getScoreCache() }));
  });
}
