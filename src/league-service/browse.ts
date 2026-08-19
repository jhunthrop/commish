import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { BrowseFilter, PublicLeagueSummary } from "@/matchmaking/contract";
import { hasOpenSeat, matchesBrowseFilter } from "@/matchmaking/filter";

/**
 * The disclosure allowlist, in one place. Exported so the tests and the route assert against
 * THIS rather than a hand-copied list that could quietly fall behind the mapping below.
 */
export const PUBLIC_LEAGUE_FIELDS: readonly (keyof PublicLeagueSummary)[] = [
  "id",
  "name",
  "format",
  "experienceTier",
  "stakeTier",
  "teamCount",
  "filledTeams",
];

/**
 * The ONE unauthenticated league read in this application.
 *
 * Three things make it safe, and all three are here rather than spread over a route and a
 * component:
 *
 * 1. **Opt-in only.** `is_public_matchmade` is false for every league by default, so a league
 *    a commissioner made for their group chat is not merely ranked low here — it is invisible.
 * 2. **A narrow projection.** The select names exactly the columns `PublicLeagueSummary`
 *    declares. `commissioner_user_id`, the roster shape, the invite codes, the draft id and
 *    every team and owner name are never read, so they cannot leak through a spread.
 * 3. **Joinable or nothing.** A full league, or one whose draft has already started, is not a
 *    thing a stranger can act on, and listing it would be a card that only leads to a refusal.
 *
 * Two queries, not one per league: a league's fill count is a `teams` tally, and a manager
 * scanning fifty open leagues must not cost fifty round trips. The format/tier narrowing runs
 * through the SAME pure `matchesBrowseFilter` the browse page's tests exercise, so the wire and
 * the rule cannot drift.
 */
export async function listPublicLeagues(db: Db, filter: BrowseFilter): Promise<readonly PublicLeagueSummary[]> {
  const leagueRows = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      format: leagues.format,
      experienceTier: leagues.experienceTier,
      stakeTier: leagues.stakeTier,
      teamCount: leagues.teamCount,
    })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .where(and(eq(leagues.isPublicMatchmade, true), eq(drafts.status, "scheduled")))
    .orderBy(asc(leagues.createdAt));
  if (leagueRows.length === 0) return [];

  const ids = leagueRows.map((row) => row.id);
  const teamRows = await db.select({ leagueId: teams.leagueId }).from(teams).where(inArray(teams.leagueId, ids));
  const filledByLeague = new Map<string, number>();
  for (const row of teamRows) filledByLeague.set(row.leagueId, (filledByLeague.get(row.leagueId) ?? 0) + 1);

  return leagueRows
    .map((row): PublicLeagueSummary => ({ ...row, filledTeams: filledByLeague.get(row.id) ?? 0 }))
    .filter((league) => hasOpenSeat(league) && matchesBrowseFilter(league, filter))
    .slice(0, MATCHMAKING_CONFIG.maxResults);
}
