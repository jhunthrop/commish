import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, scoringSettings, teams } from "@/db/schema";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { BrowseFilter, PublicLeagueSummary } from "@/matchmaking/contract";
import { describeScoring, type ScoringRules } from "@/scoring";

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
  "scoringLabel",
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
 *
 * Exported as a builder, not just run inline, so `src/db/index-plans.test.ts` can `EXPLAIN`
 * exactly what production runs rather than a hand-copied lookalike that could drift into being
 * fast while the real one is slow.
 */
export function browseQuery(db: Db, filter: BrowseFilter) {
  return db
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
}

/**
 * Every raw scoring weight, keyed by league id — never returned to a caller. `listPublicLeagues`
 * reduces each row straight to `describeScoring`'s derived label before this function's result
 * ever leaves this module, so the fifteen weights themselves stay exactly as member-only as they
 * were before this task; only the label they describe is new to the public wire.
 *
 * A SEPARATE query rather than a third join on `browseQuery`: that query is already a `GROUP BY
 * leagues.id` aggregate (the fill count), and joining a one-row-per-league table into it would
 * mean either widening the `GROUP BY` to every scoring column or wrapping each in `max()` for no
 * reason — `scoring_settings.league_id` is that table's primary key, so a batched `IN` lookup
 * against the page `browseQuery` already narrowed to `maxResults` rows is one extra, trivially
 * indexed query, not a second scan of `leagues`.
 */
async function scoringWeightsByLeagueId(db: Db, leagueIds: readonly string[]): Promise<ReadonlyMap<string, ScoringRules>> {
  if (leagueIds.length === 0) return new Map();
  const rows = await db
    .select({
      leagueId: scoringSettings.leagueId,
      pointsPerPassingYard: scoringSettings.pointsPerPassingYard,
      pointsPerPassingTouchdown: scoringSettings.pointsPerPassingTouchdown,
      pointsPerInterception: scoringSettings.pointsPerInterception,
      pointsPerRushingYard: scoringSettings.pointsPerRushingYard,
      pointsPerRushingTouchdown: scoringSettings.pointsPerRushingTouchdown,
      pointsPerReceivingYard: scoringSettings.pointsPerReceivingYard,
      pointsPerReceivingTouchdown: scoringSettings.pointsPerReceivingTouchdown,
      pointsPerReception: scoringSettings.pointsPerReception,
      pointsPerFumbleLost: scoringSettings.pointsPerFumbleLost,
      teReceptionBonus: scoringSettings.teReceptionBonus,
      pointsPerFieldGoal: scoringSettings.pointsPerFieldGoal,
      pointsPerExtraPoint: scoringSettings.pointsPerExtraPoint,
      pointsPerSack: scoringSettings.pointsPerSack,
      pointsPerDefensiveInterception: scoringSettings.pointsPerDefensiveInterception,
      pointsPerDefensiveTouchdown: scoringSettings.pointsPerDefensiveTouchdown,
    })
    .from(scoringSettings)
    .where(inArray(scoringSettings.leagueId, [...leagueIds]));
  return new Map(rows.map(({ leagueId, ...weights }) => [leagueId, weights]));
}

/**
 * `scoringLabel` is a deliberate disclosure — see `PublicLeagueSummary`'s docblock — and it is
 * derived HERE, once, from the league's weights, never passed through as the fifteen raw
 * numbers. A league somehow missing its `scoring_settings` row (never true in production —
 * `createLeague` writes both in one transaction) reads "Custom" rather than throwing: a browse
 * card is not the place to surface a data-integrity bug to a stranger.
 */
export async function listPublicLeagues(db: Db, filter: BrowseFilter): Promise<readonly PublicLeagueSummary[]> {
  const rows = await browseQuery(db, filter);
  const weightsByLeagueId = await scoringWeightsByLeagueId(db, rows.map((row) => row.id));
  return rows.map((row) => {
    const weights = weightsByLeagueId.get(row.id);
    return { ...row, scoringLabel: weights === undefined ? "Custom" : describeScoring(weights) };
  });
}
