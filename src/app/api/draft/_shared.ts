import { getDb } from "@research/db/client";
import { fail } from "@/lib/api/respond";
import { requireLeagueMember, resolveLeagueMembership } from "@/lib/leagues/membership";
import { withCurrentUser } from "@/app/api/leagues/_shared";

/** Draft HQ's sheet routes share the plain "who is signed in" gate every `/api/leagues/**`
 *  route already uses — a sheet is a user-owned resource, not a league one, so it needs no
 *  league-membership resolution UNLESS it is scoped to a league (see `assertLeagueAccessible`
 *  below). */
export { withCurrentUser };

/**
 * A league-scoped sheet (`leagueId` non-null) is only the caller's to read or write if they
 * belong to that league — the same `requireLeagueMember` rule every other league-scoped surface
 * in this product enforces, asked here at the API boundary rather than inside the sheet service,
 * which stays a plain per-user store. Returns the `fail()` response to short-circuit with, or
 * `null` when the caller may proceed. A `null` `leagueId` (the format-default sheet) needs no
 * check at all.
 */
export async function assertLeagueAccessible(userId: string, leagueId: string | null | undefined): Promise<Response | null> {
  if (leagueId === null || leagueId === undefined) return null;
  const membership = await resolveLeagueMembership(getDb(), leagueId, userId);
  if (!membership.ok) return fail(membership.error, membership.status);
  return requireLeagueMember(membership.membership);
}

export interface SheetRouteContext {
  readonly params: Promise<{ readonly sheetId: string }>;
}
