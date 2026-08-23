import { and, asc, eq, inArray, isNotNull, isNull, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { drafts, leagues, scoringSettings, teams } from "@/db/schema";
import type { DraftFormat } from "@/domain/league";
import type { Clock } from "@/domain/timing";
import type { ExperienceTier } from "@/domain/user";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { formatDraftTime } from "@/league";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { BrowseBody, BrowseFilter, PublicLeagueSummary } from "@/matchmaking/contract";
import type { HouseRungName } from "@/matchmaking/house-catalog";
import { compositionCategoryFor, tierCompositionFor } from "@/participation/composition";
import { describeScoring, type ScoringRules } from "@/scoring";

/** The outermost edge is the only place a wall clock is allowed — see every other service
 *  module's identical constant (`creation.ts`, `read.ts`, ...). */
const systemClock: Clock = { now: () => new Date().toISOString() };

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
  "compositionCategory",
  "draftAt",
  "medianGame",
  "startTrigger",
  "houseRung",
];

/** The league's own seats, aliased a second time so a `LATERAL` join can ask "how many of THIS
 *  seat-holder's OTHER leagues have completed a season" without colliding with the outer
 *  query's own `teams`/`leagues` references — the identical shape `memberTeams`/`memberLeagues`
 *  (`@/league-service/participation`) already use for the single-league read. */
const seatTeams = alias(teams, "seat_teams");
const seatLeagues = alias(leagues, "seat_leagues");

/**
 * One seated manager's OWN completed-season count, as a query built to run `LATERAL` — correlated
 * to the outer query's own `teams` row (the league's seat) by `user_id`, never by league, so it
 * counts the seat-holder's OTHER completed leagues. `teams` is joined TWICE for the same reason
 * `memberCompletedSeasonsQuery` (`@/league-service/participation`) already joins it twice: once
 * for the league's own seats (the outer query's `teams`), once for the seat-holder's history
 * (`seatTeams`/`seatLeagues` here).
 *
 * `LATERAL`, not a second `GROUP BY` join on the outer query: a plain join would fan the outer
 * query's `teams` rows across every one of a seat-holder's OTHER teams before `GROUP BY
 * leagues.id` ever ran, corrupting `filledTeams` (`count(teams.id)`) in the same breath this task
 * fixes composition. A `LATERAL` subquery answers with a SCALAR per outer row — one number per
 * seat, never a fan-out — which is what keeps `filledTeams` exactly as correct as it was before.
 */
function seatCompletedSeasonsQuery(db: Db) {
  return db
    .select({ completedSeasons: sql<number>`count(${seatLeagues.id})::int`.as("completed_seasons") })
    .from(seatTeams)
    .leftJoin(seatLeagues, and(eq(seatLeagues.id, seatTeams.leagueId), isNotNull(seatLeagues.seasonCompletedAt)))
    .where(eq(seatTeams.userId, teams.userId));
}

/**
 * The `newcomers`/`veterans` pair, as one shared expression rather than two copies — `browseQuery`
 * (the member list) and `houseShelfQuery` (Phase 3.5 addendum, Task 14) both fold the identical
 * composition join into their own `GROUP BY`, and this is the one place the `>=`/`<` split against
 * `cutoff` is written down. `seatCompletion` is each query's OWN `leftJoinLateral` alias — passed
 * in rather than built here, because the alias has to be joined into the specific query it feeds,
 * and this function only ever emits the two `SQL` expressions that read from it.
 */
function participationAggregates(
  seatCompletion: { readonly completedSeasons: SQLWrapper },
  cutoff: number,
): { readonly veteranSeats: SQL<number>; readonly newcomerSeats: SQL<number> } {
  // `teams.id IS NOT NULL` excludes an unfilled seat from both buckets — an empty seat is
  // neither a newcomer nor a veteran, the same reason `filledTeams` itself is `count(teams.id)`
  // rather than `count(*)`.
  return {
    veteranSeats: sql<number>`count(*) filter (where ${teams.id} is not null and ${seatCompletion.completedSeasons} >= ${cutoff})::int`,
    newcomerSeats: sql<number>`count(*) filter (where ${teams.id} is not null and ${seatCompletion.completedSeasons} < ${cutoff})::int`,
  };
}

/**
 * Turns a normalized filter into the narrowing predicates the query applies. `undefined` for a
 * field means "any", and Drizzle's `and()` drops `undefined` operands, so an unnarrowed browse
 * produces exactly the two mandatory predicates and nothing else.
 *
 * `participationTier` is deliberately NOT here: the other three narrow on a raw column `leagues`
 * already carries, evaluated in the `WHERE` before any aggregation runs. Participation is a fact
 * about the league's SEATS, not a column on `leagues` itself, so it can only be evaluated after
 * the composition aggregate exists — `browseQuery` applies it as a `HAVING` predicate instead,
 * built from the SAME `newcomers`/`veterans` expressions the composition label reads.
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
 *
 * PHASE 3 PLAN D, TASK 2. `newcomers`/`veterans` are a `GROUP BY` folded into this SAME query,
 * beside `filledTeams`, rather than a per-league round trip: the browse page returns up to
 * `maxResults` (48) leagues, and 48 round trips on this app's one unauthenticated route is
 * exactly the N+1 `listLeagueActivity`'s own shape exists to refuse. Task 1 shipped a per-league
 * reader for this exact aggregate (`leagueTierComposition`, `@/league-service/participation`) for
 * a caller that never arrived — this task's fix-round deleted it rather than leaving a
 * reserved-without-owner helper beside the query that made it redundant; `git log` on
 * `src/league-service/participation.ts` carries its history for a reader who needs the shape it
 * used. Both counts, and the `participationTier`
 * `HAVING` predicate built from them, apply BEFORE the `LIMIT` — the same "narrow before you cap"
 * property `filledTeams`'s own open-seat `HAVING` already holds, so a participation-narrowed
 * browse returns every match the database holds up to the cap, never an under-filled page
 * because the cap ate the candidates first.
 *
 * Measured (`src/db/index-plans.test.ts`, "plans the browse query with the composition join")
 * over the 5,000-league realistic corpus: the plan still leads with `leagues_public_browse_idx`
 * and never sequentially scans `leagues` — the `LATERAL` join is a scalar per seat, not a fan-out,
 * so it changes the plan's shape below the `GROUP BY` without changing which index the planner
 * chooses to find the candidate leagues in the first place.
 *
 * `leagues_season_completed_idx` (`drizzle/0028_season_completion.sql`), flagged in Task 1's
 * review as an index with no consumer anywhere in the plan: `seatCompletedSeasonsQuery`'s `LEFT
 * JOIN` carries `season_completed_at IS NOT NULL` in its own `ON` clause, alongside the id
 * equality (`and(eq(seatLeagues.id, seatTeams.leagueId), isNotNull(seatLeagues.seasonCompletedAt))`
 * — the same shape the now-deleted `memberCompletedSeasonsQuery` used) — which matches this
 * partial index's own predicate exactly, so the planner answers with an `Index Only Scan` on it
 * rather than a primary-key lookup plus a heap fetch. Measured, not assumed: "DOES choose
 * leagues_season_completed_idx" in `index-plans.test.ts`. The index has a real consumer after
 * all, and no drop migration ships.
 */
export function browseQuery(db: Db, filter: BrowseFilter) {
  const ANY = MATCHMAKING_CONFIG.anyValue;
  const cutoff = INTEGRITY_CONFIG.participation.veteranSeasonCutoff;
  const seatCompletion = seatCompletedSeasonsQuery(db).as("seat_completion");
  const { veteranSeats, newcomerSeats } = participationAggregates(seatCompletion, cutoff);
  // The SAME `newcomers > veterans` comparison `compositionCategoryFor` (`@/participation/
  // composition`) renders the label from, expressed once here in SQL rather than reimplemented —
  // `filter.test.ts` cross-checks the two never disagree over one corpus.
  const participationHaving =
    filter.participationTier === ANY
      ? undefined
      : filter.participationTier === "newcomer"
        ? sql`${newcomerSeats} > ${veteranSeats}`
        : sql`not (${newcomerSeats} > ${veteranSeats})`;

  return db
    .select({
      id: leagues.id,
      name: leagues.name,
      format: leagues.format,
      experienceTier: leagues.experienceTier,
      stakeTier: leagues.stakeTier,
      teamCount: leagues.teamCount,
      medianGame: leagues.medianGame,
      filledTeams: sql<number>`count(${teams.id})::int`,
      // A plain column, not an aggregate. Postgres accepts an ungrouped column only when the
      // `GROUP BY` covers ITS OWN table's primary key, so `drafts.id` joins `leagues.id` in the
      // `groupBy` below — `drafts_league_id_idx` (`@/db/schema`) makes that a no-op on
      // cardinality (still exactly one draft row per league), purely a functional-dependency
      // proof for the planner.
      kickoffAt: drafts.kickoffAt,
      startTrigger: drafts.startTrigger,
      newcomers: newcomerSeats,
      veterans: veteranSeats,
    })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .leftJoin(teams, eq(teams.leagueId, leagues.id))
    .leftJoinLateral(seatCompletion, sql`true`)
    // `isNull(leagues.houseRung)` (Phase 3.5 addendum, Task 14): the member list's own half of
    // the shelf/list split — a house league never reaches this query at all, so it can never be
    // sorted into the member list's seats-remaining ordering. `houseShelfQuery` below is the
    // house half, over the OPPOSITE predicate, with its own soonest-draft ordering.
    .where(and(eq(leagues.isPublicMatchmade, true), eq(drafts.status, "scheduled"), isNull(leagues.houseRung), ...narrowingFor(filter)))
    .groupBy(leagues.id, drafts.id)
    .having(and(sql`count(${teams.id}) < ${leagues.teamCount}`, participationHaving))
    // PHASE 3.5, TASK 8, STEP 4. Seats remaining ASC, then `created_at` ASC as the tiebreaker
    // (the ordering this replaced, kept second so ties still resolve oldest-first). §4.1's
    // liquidity doctrine is concentration — the lobby's job is to FILL leagues, and a nearly-full
    // one a single join would complete is worth surfacing ahead of a freshly created one nobody
    // has joined yet. `count(${teams.id})` is the SAME aggregate `filledTeams` already computes
    // two lines up; this is a second reference to it, not a second query. Cost is measured, not
    // asserted: this docblock's own claim — the sort runs AFTER the `GROUP BY` either way, so
    // changing the sort KEY costs nothing the unsorted plan wasn't already paying — is pinned by
    // `src/db/index-plans.test.ts`'s "plans the seats-remaining ordering" assertion, built from
    // the SAME 5,000-league realistic corpus every other browse plan assertion uses.
    .orderBy(sql`(${leagues.teamCount} - count(${teams.id})) asc`, asc(leagues.createdAt))
    .limit(MATCHMAKING_CONFIG.maxResults);
}

/**
 * The house shelf's own query (Phase 3.5 addendum, Task 14, Step 2) — a SECOND query against
 * `leagues_house_rung_idx`, never an `ORDER BY` bolted onto `browseQuery`'s member-list results.
 * Two reasons, and the second is load-bearing: mechanically, `browseQuery` already orders by
 * seats-remaining (Task 8), and a house-first sort would fight that ordering for the top rows;
 * more importantly, a shelf and a list are different promises (`BrowseBody`'s own docblock), and
 * collapsing them into one ordered array makes the shelf's promise unreadable.
 *
 * TAKES NO `BrowseFilter`, unlike `browseQuery` — not merely unfiltered by default, but
 * structurally unable to be. `houseRung` is deliberately not a `BrowseFilter` field
 * (`filter.test.ts`'s "refuses to let a filter hide the shelf"), and every catalog rung already
 * shares one canonical format/roster/scoring shape (`HOUSE_CATALOG`'s own `CANON`) — so a filter
 * axis narrowing the shelf could only ever empty it for some visitor, never sort it, which is
 * exactly the failure "there is always a seat" promises against.
 *
 * ORDERED BY THE DRAFT A VISITOR CAN ATTEND SOONEST — `drafts.kickoff_at` ascending — a
 * DIFFERENT rule from the member list's seats-remaining-first, and correct for a different
 * reason: the member list's job is to fill leagues that are nearly full; the shelf's job is to
 * hand a visitor the draft they can actually attend tonight.
 *
 * NOT `leagues_house_rung_idx`'s own second column. That index is `(house_rung, created_at)`,
 * carrying `created_at` for the RECONCILER's own count (`openHouseLeaguesQuery`,
 * `@/league-service/house-factory.ts`, which reads house rows in creation order to assign each
 * new spawn the next stagger slot) — a documented drift this task closes rather than repeats: an
 * earlier draft of both that index's own docblock and this module assumed creation order and the
 * soonest-draft order would coincide, because a `scheduled` rung's kickoff IS creation-ordered
 * WITHIN one rung (`houseKickoffFor`'s own stagger). They do NOT coincide ACROSS rungs — `open_12`
 * and `beginner_12` stagger on different clocks, and interleaving them by `created_at` is not the
 * same order as interleaving them by `kickoff_at`. `leagues_house_rung_idx` still serves this
 * query's `WHERE house_rung IS NOT NULL` predicate (its partial predicate matches exactly, the
 * same reasoning `leagues_season_completed_idx`'s own consumer note carries) — the plan is an
 * index scan for the FILTER, then a `Sort` on `kickoff_at` for the order, measured rather than
 * assumed in `src/db/index-plans.test.ts`.
 */
export function houseShelfQuery(db: Db) {
  const cutoff = INTEGRITY_CONFIG.participation.veteranSeasonCutoff;
  const seatCompletion = seatCompletedSeasonsQuery(db).as("seat_completion");
  const { veteranSeats, newcomerSeats } = participationAggregates(seatCompletion, cutoff);

  return db
    .select({
      id: leagues.id,
      name: leagues.name,
      format: leagues.format,
      experienceTier: leagues.experienceTier,
      stakeTier: leagues.stakeTier,
      teamCount: leagues.teamCount,
      medianGame: leagues.medianGame,
      houseRung: leagues.houseRung,
      filledTeams: sql<number>`count(${teams.id})::int`,
      kickoffAt: drafts.kickoffAt,
      startTrigger: drafts.startTrigger,
      newcomers: newcomerSeats,
      veterans: veteranSeats,
    })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .leftJoin(teams, eq(teams.leagueId, leagues.id))
    .leftJoinLateral(seatCompletion, sql`true`)
    .where(and(isNotNull(leagues.houseRung), eq(drafts.status, "scheduled")))
    .groupBy(leagues.id, drafts.id)
    .having(sql`count(${teams.id}) < ${leagues.teamCount}`)
    .orderBy(asc(drafts.kickoffAt))
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

/** The fields `browseQuery` and `houseShelfQuery` both project — everything `summarizeRow` needs
 *  to build a `PublicLeagueSummary` regardless of which of the two queries a row came from. */
interface SummarizableRow {
  readonly id: string;
  readonly name: string;
  readonly format: DraftFormat;
  readonly experienceTier: ExperienceTier;
  readonly stakeTier: number;
  readonly teamCount: number;
  readonly medianGame: boolean;
  readonly filledTeams: number;
  readonly kickoffAt: Date;
  readonly startTrigger: "scheduled" | "when_full";
  readonly newcomers: number;
  readonly veterans: number;
}

/**
 * One row, from either query, to one `PublicLeagueSummary` — the single place `scoringLabel` and
 * `compositionCategory` get derived, shared by the member list and the house shelf so the two
 * can never render the same fact two different ways. `houseRung` is passed in rather than read
 * off `row` (`browseQuery`'s own rows never carry the column at all — a member league has none to
 * carry) so this function has exactly one signature for both callers.
 *
 * `scoringLabel` is a deliberate disclosure — see `PublicLeagueSummary`'s docblock — and it is
 * derived HERE, once, from the league's weights, never passed through as the fifteen raw
 * numbers. A league somehow missing its `scoring_settings` row (never true in production —
 * `createLeague` writes both in one transaction) reads "Custom" rather than throwing: a browse
 * card is not the place to surface a data-integrity bug to a stranger.
 *
 * `compositionCategory` is assembled the same way, and the reduction to a COARSE bucket happens
 * HERE (final review F6): `newcomers`/`veterans` go through `tierCompositionFor` and then
 * `compositionCategoryFor` (`@/participation/composition`), and only the bucket reaches the
 * return value — the two raw counts die in this function. Before F6 they shipped on the wire and
 * the client reduced them, which made an aggregate over one filled seat a disclosure of that one
 * manager's tier to anyone holding the URL — `TierComposition`'s own docblock carries the whole
 * argument.
 */
function summarizeRow(
  row: SummarizableRow,
  houseRung: HouseRungName | null,
  weightsByLeagueId: ReadonlyMap<string, ScoringRules>,
  now: string,
): PublicLeagueSummary {
  const weights = weightsByLeagueId.get(row.id);
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    experienceTier: row.experienceTier,
    stakeTier: row.stakeTier,
    teamCount: row.teamCount,
    filledTeams: row.filledTeams,
    scoringLabel: weights === undefined ? "Custom" : describeScoring(weights),
    compositionCategory: compositionCategoryFor(tierCompositionFor({ newcomers: row.newcomers, veterans: row.veterans })),
    draftAt: formatDraftTime(row.kickoffAt.toISOString(), now),
    medianGame: row.medianGame,
    startTrigger: row.startTrigger,
    houseRung,
  };
}

/**
 * The whole browse read (Phase 3.5 addendum, Task 14): the member list, off `browseQuery`, and
 * the house shelf, off `houseShelfQuery` — two queries answering two different promises
 * (`BrowseBody`'s own docblock), never one list a `houseRung` sort key folds together. Both run
 * before the ONE scoring lookup, batched over the combined id set, so a page with both a shelf
 * and a list still costs exactly three queries total — not two-per-half — the same "one extra,
 * trivially indexed query" discipline `scoringWeightsByLeagueId`'s own docblock already holds
 * `browseQuery` alone to.
 */
export async function listPublicLeagues(db: Db, filter: BrowseFilter, clock: Clock = systemClock): Promise<BrowseBody> {
  const memberRows = await browseQuery(db, filter);
  const houseRows = await houseShelfQuery(db);
  const weightsByLeagueId = await scoringWeightsByLeagueId(db, [...memberRows, ...houseRows].map((row) => row.id));
  const now = clock.now();
  return {
    leagues: memberRows.map((row) => summarizeRow(row, null, weightsByLeagueId, now)),
    house: houseRows.map((row) => summarizeRow(row, row.houseRung as HouseRungName, weightsByLeagueId, now)),
  };
}
