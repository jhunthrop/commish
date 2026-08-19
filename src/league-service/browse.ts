import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { BrowseFilter, PublicLeagueSummary } from "@/matchmaking/contract";

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
 * Turns a normalized filter into the narrowing predicates the query applies. `undefined` for a
 * field means "any", and Drizzle's `and()` drops `undefined` operands, so an unnarrowed browse
 * produces exactly the two mandatory predicates and nothing else.
 */
function narrowingFor(filter: BrowseFilter): readonly (SQL | undefined)[] {
  const ANY = MATCHMAKING_CONFIG.anyValue;
  return [
    filter.format === ANY ? undefined : eq(leagues.format, filter.format),
    filter.experienceTier === ANY ? undefined : eq(leagues.experienceTier, filter.experienceTier),
    filter.stakeTier === ANY ? undefined : eq(leagues.stakeTier, filter.stakeTier),
  ];
}

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
 * ONE query, not two: a league's fill count is a grouped `count(teams.id)`, and the open-seat
 * rule is a `HAVING` predicate rather than a JS filter over an already-capped page. That
 * ordering is the correctness property — every narrowing (format, experience tier, stake tier,
 * open seat) is applied BEFORE the `LIMIT`, so a filtered browse returns every match the
 * database holds up to the cap, never an under-filled page because the cap ate the candidates
 * first. That was a real defect in the previous two-query form, documented there as a known
 * tradeoff and closed here.
 *
 * `matchesBrowseFilter`/`hasOpenSeat` in `src/matchmaking/filter.ts` remain the product's
 * canonical, 100%-covered statement of the same rule, and `browse.test.ts` runs every one of
 * the 3 x 3 x 5 filter combinations through BOTH this query and that pure rule over one seeded
 * corpus, demanding identical answers. Two expressions of one rule is how a drift starts; that
 * test is what makes a drift a failing build.
 */
export async function listPublicLeagues(db: Db, filter: BrowseFilter): Promise<readonly PublicLeagueSummary[]> {
  const rows = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      format: leagues.format,
      experienceTier: leagues.experienceTier,
      stakeTier: leagues.stakeTier,
      teamCount: leagues.teamCount,
      filledTeams: sql<number>`count(${teams.id})::int`,
    })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .leftJoin(teams, eq(teams.leagueId, leagues.id))
    .where(and(eq(leagues.isPublicMatchmade, true), eq(drafts.status, "scheduled"), ...narrowingFor(filter)))
    .groupBy(leagues.id)
    .having(sql`count(${teams.id}) < ${leagues.teamCount}`)
    .orderBy(asc(leagues.createdAt))
    .limit(MATCHMAKING_CONFIG.maxResults);

  return rows;
}
