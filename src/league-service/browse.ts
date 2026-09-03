import { and, asc, eq, gt, inArray, isNotNull, isNull, notLike, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { drafts, leagues, scoringSettings, seatHolds, teams } from "@/db/schema";
import type { DraftFormat } from "@/domain/league";
import type { RosterSlotConfig } from "@/domain/roster";
import type { Clock } from "@/domain/timing";
import type { ExperienceTier } from "@/domain/user";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { envOrUndefined } from "@/lib/env";
import { describeRosterShape, formatDraftTime, LEAGUE_CONFIG } from "@/league";
import { ROSTER_SHAPE_LABEL } from "@/domain/roster";
import { houseKickoffStillAhead } from "./house-factory";
import { FIXTURE_LEAGUE_NAME_PREFIXES } from "@/matchmaking/fixtures";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { BrowseBody, BrowseFilter, PublicLeagueSummary } from "@/matchmaking/contract";
import type { HouseRungName } from "@/matchmaking/house-catalog";
import type { PrizeTable } from "@/money/prize-table";
import { compositionCategoryFor, tierCompositionFor } from "@/participation/composition";
import { describeScoring, type ScoringRules } from "@/scoring";

/**
 * D1 (storefront review; flow analysis J04) — THE ONE SHARED PREDICATE that keeps a seeded or
 * end-to-end-test league off every public read this application makes. Dev fixtures write a
 * `leagues.name` starting with one of `FIXTURE_LEAGUE_NAME_PREFIXES` (`@/matchmaking/fixtures`,
 * the pure list both this function and any future pure caller read) — 17 of 50 rows on a real
 * seeded database once carried a name like "E2E Money Dark 1787678163994", indistinguishable to a
 * stranger from a real listing, sitting directly under a promise that "every league is free".
 *
 * NEVER restated per query — `browseQuery` and `houseShelfQuery` below both call this once, and
 * so do `seatClaimsQuery`/`filledLeaguesQuery` (`@/league-service/wire.ts`) and
 * `leaguesFilledQuery`/`fillingRoomsQuery` (`@/league-service/proof.ts`) — the front door shelf,
 * `/browse`, the wire and the proof strip all read the SAME condition rather than four hand
 * copies that could quietly drift apart on which prefixes they exclude.
 *
 * Exported as the query BUILDER, the same shape `houseKickoffStillAhead`
 * (`@/league-service/house-factory.ts`) already uses for a predicate two different queries share.
 *
 * ONE ENVIRONMENT OPTS OUT, and only one: the end-to-end suite's own server. Those specs seed a
 * league, then join it THROUGH the product's real front door — `/browse`, the Join button, the
 * waiting room — which is the whole value of the coverage. Hiding fixture leagues from every
 * public read made that walk impossible: `money-dark.spec.ts` waited sixty seconds for a Join
 * button on a league the shelf had filtered out from under it, and four other specs timed out the
 * same way. The suite and the founder's dev server share one database but never one server
 * process (the suite runs `next start` on :3100, the founder's `next dev` holds :3000), so the
 * server's own environment is the honest seam: `E2E_SHOW_FIXTURE_LEAGUES=1` is set by
 * `playwright.config.ts`'s `webServer.env` and by nothing else in this repo.
 *
 * Fails CLOSED. Anything other than the literal `"1"` — unset, empty, `"true"`, `"0"` — hides
 * fixtures, so the founder's shelf and any deploy get the filtered read by default and an
 * operator has to opt in on purpose to see otherwise.
 */
export function notAFixtureLeague(): SQL | undefined {
  if (envOrUndefined("E2E_SHOW_FIXTURE_LEAGUES") === "1") return undefined;
  // `and()` with two or more defined `SQLWrapper` operands always returns a real `SQL`, never
  // `undefined` — `FIXTURE_LEAGUE_NAME_PREFIXES` is a fixed, non-empty literal array, so this
  // assertion is safe rather than hopeful (the identical shape `houseKickoffStillAhead`'s own
  // `or(...)` call is trusted without one, here spelled explicitly because `and()`'s general
  // signature stays `SQL | undefined` for the zero- and one-operand cases this call never hits).
  return and(...FIXTURE_LEAGUE_NAME_PREFIXES.map((prefix) => notLike(leagues.name, `${prefix}%`)))!;
}

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
  "entryFeeCents",
  "teamCount",
  "filledTeams",
  "scoringLabel",
  "compositionCategory",
  "draftAt",
  "draftAtIso",
  "medianGame",
  "startTrigger",
  "houseRung",
  "heldSeats",
  "rosterSummary",
  "playoffWeeks",
  "kickoffRolls",
  "payoutTable",
];

/**
 * The two or three week numbers the platform's standard playoff bracket runs across — computed
 * ONCE, from config, at module load, never per row. `LEAGUE_CONFIG.playoffTeams` (Phase 3.6,
 * Task 5) is a single-elimination bracket seeded up to the next power of two, so it needs
 * `ceil(log2(playoffTeams))` rounds: today's `6` needs `3` (a bracket of 6 pads to 8), so the
 * league's regular season (`regularSeasonWeeks`, 14) is followed by weeks 15, 16 and 17. Neither
 * tunable varies per league in this codebase (`generateSchedule`'s own callers all pass
 * `LEAGUE_CONFIG.regularSeasonWeeks` — see that constant's own docblock), so this is one constant
 * shared by every `PublicLeagueSummary` row, not a per-league query.
 */
const PLAYOFF_WEEKS: readonly number[] = Array.from(
  { length: Math.ceil(Math.log2(LEAGUE_CONFIG.playoffTeams)) },
  (_, index) => LEAGUE_CONFIG.regularSeasonWeeks + index + 1,
);

/**
 * "15 slots, 1 flex" / "16 slots, 2 flex, superflex" — `PublicLeagueSummary.rosterSummary`'s own
 * derivation, through the existing `describeRosterShape` (`@/league/roster-shape`). The flex
 * count folds `FLEX` and `SUPERFLEX` together (a superflex league's second flex-like slot is
 * still a flex-like slot to a stranger deciding whether to join), and the shape clause is only
 * ever appended for a genuinely superflex league — "Custom" (a commissioner-edited shape) adds
 * nothing false rather than guessing at a label the slots no longer earn.
 */
function rosterSummaryFor(slots: readonly RosterSlotConfig[]): string {
  const totalSlots = slots.reduce((sum, slot) => sum + slot.count, 0);
  const flexSlots = slots.filter((slot) => slot.slot === "FLEX" || slot.slot === "SUPERFLEX").reduce((sum, slot) => sum + slot.count, 0);
  const shapeClause = describeRosterShape(slots) === ROSTER_SHAPE_LABEL.superflex ? ", superflex" : "";
  return `${totalSlots} slots, ${flexSlots} flex${shapeClause}`;
}

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
 * Phase 3.6, Task 5, Step 4: the shelf's own "Drafting soonest" sort pill and "Drafts when full"
 * toggle — deliberately NOT `BrowseFilter` fields. Ruling 1's "variety in toggles, not queues"
 * keeps every `BrowseFilter` axis a way an open seat could go invisible; these two are neither a
 * privacy boundary nor a narrowing `matchesBrowseFilter`'s own pure mirror has to cross-check
 * (`browse.test.ts`'s 3x3x5 corpus), so they are a second, separate parameter `browseQuery` reads
 * directly rather than a fourth and fifth axis added to that contract. Both default to today's
 * exact behavior — seats-remaining ordering, no `startTrigger` narrowing — so every existing
 * caller (`index-plans.test.ts` included) is unaffected by leaving this argument off entirely.
 */
export interface BrowseQueryOptions {
  /** `"seats_remaining"` (default, Task 8's liquidity-first order) or `"soonest"` (Task 5's own
   *  addition — the draft a visitor could attend tonight, first). */
  readonly sort?: "seats_remaining" | "soonest";
  /** Narrows the member list to `when_full` leagues only. Never applied to the house shelf — see
   *  `houseShelfQuery`'s own docblock on why that query takes no filter at all. */
  readonly whenFullOnly?: boolean;
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
export function browseQuery(db: Db, filter: BrowseFilter, options: BrowseQueryOptions = {}) {
  const ANY = MATCHMAKING_CONFIG.anyValue;
  const cutoff = INTEGRITY_CONFIG.participation.veteranSeasonCutoff;
  const seatCompletion = seatCompletedSeasonsQuery(db).as("seat_completion");
  const { veteranSeats, newcomerSeats } = participationAggregates(seatCompletion, cutoff);
  const sort = options.sort ?? "seats_remaining";
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
      entryFeeCents: leagues.entryFeeCents,
      // Front door blueprint (2026-09-02): the published prize table, straight through — the
      // same ungrouped-plain-column reasoning `entryFeeCents` above already rides on.
      payoutTable: leagues.payoutTable,
      teamCount: leagues.teamCount,
      medianGame: leagues.medianGame,
      // Ungrouped, on the identical functional-dependency proof `kickoffAt`/`startTrigger`
      // below already rely on: `drafts.id` joins `leagues.id` in this query's own `groupBy`,
      // and `leagues.id` is this table's own primary key, so Postgres accepts the column
      // without folding it into the `GROUP BY` itself.
      rosterSlots: leagues.rosterSlots,
      filledTeams: sql<number>`count(${teams.id})::int`,
      // A plain column, not an aggregate. Postgres accepts an ungrouped column only when the
      // `GROUP BY` covers ITS OWN table's primary key, so `drafts.id` joins `leagues.id` in the
      // `groupBy` below — `drafts_league_id_idx` (`@/db/schema`) makes that a no-op on
      // cardinality (still exactly one draft row per league), purely a functional-dependency
      // proof for the planner.
      kickoffAt: drafts.kickoffAt,
      startTrigger: drafts.startTrigger,
      kickoffRolls: drafts.kickoffRolls,
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
    .where(
      and(
        eq(leagues.isPublicMatchmade, true),
        eq(drafts.status, "scheduled"),
        isNull(leagues.houseRung),
        // Phase 3.6, Task 5, Step 4: "Drafts when full" — a plain column predicate, applied
        // BEFORE the `LIMIT` on the identical "narrow before you cap" discipline this query's
        // own docblock already holds every other narrowing to.
        options.whenFullOnly === true ? eq(drafts.startTrigger, "when_full") : undefined,
        notAFixtureLeague(),
        ...narrowingFor(filter),
      ),
    )
    .groupBy(leagues.id, drafts.id)
    .having(and(sql`count(${teams.id}) < ${leagues.teamCount}`, participationHaving))
    // PHASE 3.5, TASK 8, STEP 4, extended by Phase 3.6, Task 5, Step 4. Seats remaining ASC,
    // then `created_at` ASC as the tiebreaker, UNLESS the "Drafting soonest" sort pill asked for
    // `kickoff_at` ASC instead — the identical ordering `houseShelfQuery`'s own shelf already
    // uses, for the identical reason: a visitor asking "soonest" is asking which draft they
    // could attend tonight, not which league is closest to full. `count(${teams.id})` is the
    // SAME aggregate `filledTeams` already computes two lines up; this is a second reference to
    // it, not a second query. Cost is measured, not asserted: this docblock's own claim — the
    // sort runs AFTER the `GROUP BY` either way, so changing the sort KEY costs nothing the
    // unsorted plan wasn't already paying — is pinned by `src/db/index-plans.test.ts`'s "plans
    // the seats-remaining ordering" assertion, built from the SAME 5,000-league realistic corpus
    // every other browse plan assertion uses; that assertion exercises the DEFAULT sort, still
    // exactly as it did before this option existed.
    .orderBy(sort === "soonest" ? asc(drafts.kickoffAt) : sql`(${leagues.teamCount} - count(${teams.id})) asc`, asc(leagues.createdAt))
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
 * (`browse.test.ts`'s "refuses to let a filter hide the shelf"), and every catalog rung already
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
 * WITHIN one rung (`houseKickoffFor`'s own stagger). They do NOT coincide ACROSS rungs in general
 * — a `scheduled` `open_12` and a `scheduled` `beginner_12` could stagger on independent clocks,
 * and interleaving them by `created_at` would not be the same order as interleaving them by
 * `kickoff_at`. (Founder directive 2026-08-26: every rung is `when_full` today, so neither rung
 * staggers at all right now — this paragraph documents why creation order is the wrong general
 * assumption, not a claim that the two orders currently diverge.) `leagues_house_rung_idx` still
 * serves this query's `WHERE house_rung IS NOT NULL` predicate (its partial predicate matches
 * exactly, the same reasoning `leagues_season_completed_idx`'s own consumer note carries) — the
 * plan is an index scan for the FILTER, then a `Sort` on `kickoff_at` for the order, measured
 * rather than assumed in `src/db/index-plans.test.ts`.
 *
 * `is_public_matchmade` IS CHECKED HERE (final whole-branch review, F6). This is an
 * UNAUTHENTICATED read, and `browseQuery` above states the opt-in rule as the first of the three
 * things that make such a read safe — but the shelf half shipped without it, resting instead on
 * the convention that `spawnHouseLeagueInTx` (`./house-factory.ts`) always writes `true`. A
 * privacy boundary held by a convention is held by whoever remembers it; this one is now
 * structural, so a house row that somehow carried `false` could not reach a stranger even if
 * something wrote one. `browse.test.ts` seeds exactly that hypothetical row and requires the
 * shelf to refuse it.
 *
 * `houseKickoffStillAhead` (final whole-branch review, F2) retires a stale scheduled-trigger
 * league from the shelf at the same instant it stops counting toward the reconciler's shelf
 * width — ONE shared predicate, in `./house-factory.ts`, for exactly that reason. Without it, an
 * under-filled league whose kickoff had passed rendered FIRST, forever, reading "starting now":
  * `kickoffAt` ascending puts the most-past time at the top, and nothing could ever start it
 * (`reduceStart` refuses a draft with fewer than two teams) or repair it (a house kickoff refuses
 * edits by design). See that predicate's own docblock, and `openHouseLeaguesQuery`'s, for the
 * whole account and for why no retirement state machine ships with it.
 */
export function houseShelfQuery(db: Db, nowIso: string) {
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
      entryFeeCents: leagues.entryFeeCents,
      payoutTable: leagues.payoutTable,
      teamCount: leagues.teamCount,
      medianGame: leagues.medianGame,
      houseRung: leagues.houseRung,
      rosterSlots: leagues.rosterSlots,
      filledTeams: sql<number>`count(${teams.id})::int`,
      kickoffAt: drafts.kickoffAt,
      startTrigger: drafts.startTrigger,
      kickoffRolls: drafts.kickoffRolls,
      newcomers: newcomerSeats,
      veterans: veteranSeats,
    })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .leftJoin(teams, eq(teams.leagueId, leagues.id))
    .leftJoinLateral(seatCompletion, sql`true`)
    .where(
      and(
        eq(leagues.isPublicMatchmade, true),
        isNotNull(leagues.houseRung),
        eq(drafts.status, "scheduled"),
        houseKickoffStillAhead(nowIso),
        notAFixtureLeague(),
      ),
    )
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
      // The scoring-vocabulary widening (2026-08-30): an explicit pick that omits a weight makes
      // describeScoring read undefined !== preset and label every league "Custom" (the exact
      // failure this comment's own review caught).
      pointsPerTwoPointConversion: scoringSettings.pointsPerTwoPointConversion,
      pointsPerFieldGoalMissed: scoringSettings.pointsPerFieldGoalMissed,
      pointsPerExtraPointMissed: scoringSettings.pointsPerExtraPointMissed,
      pointsPerReturnTouchdown: scoringSettings.pointsPerReturnTouchdown,
      pointsPerDefensiveFumbleRecovery: scoringSettings.pointsPerDefensiveFumbleRecovery,
      pointsPerSafety: scoringSettings.pointsPerSafety,
    })
    .from(scoringSettings)
    .where(inArray(scoringSettings.leagueId, [...leagueIds]));
  return new Map(rows.map(({ leagueId, ...weights }) => [leagueId, weights]));
}

/**
 * Every league's live hold count, keyed by id (Phase 3.6, Task 6) — a SEPARATE, batched query
 * over the SAME page `browseQuery`/`houseShelfQuery` already narrowed, the identical shape
 * `scoringWeightsByLeagueId` above already uses and for the same reason: `seat_holds` is a
 * one-row-per-hold table with no natural place in either query's own `GROUP BY leagues.id`
 * without widening it for a third, unrelated aggregate.
 *
 * `now` is `listPublicLeagues`'s OWN single instant, read once and threaded down — never a fresh
 * `now()` read here — so a hold that expired between this query and the page's own `draftAt`
 * rendering cannot show up as live in one and past in the other, the same "one instant, every
 * card" discipline `listPublicLeagues` already holds for `draftAt`.
 */
async function heldSeatsByLeagueId(db: Db, leagueIds: readonly string[], now: string): Promise<ReadonlyMap<string, number>> {
  if (leagueIds.length === 0) return new Map();
  const rows = await db
    .select({ leagueId: seatHolds.leagueId, heldSeats: sql<number>`count(*)::int` })
    .from(seatHolds)
    .where(and(inArray(seatHolds.leagueId, [...leagueIds]), isNull(seatHolds.consumedAt), gt(seatHolds.expiresAt, new Date(now))))
    .groupBy(seatHolds.leagueId);
  return new Map(rows.map((row) => [row.leagueId, row.heldSeats]));
}

/** The fields `browseQuery` and `houseShelfQuery` both project — everything `summarizeRow` needs
 *  to build a `PublicLeagueSummary` regardless of which of the two queries a row came from. */
interface SummarizableRow {
  readonly id: string;
  readonly name: string;
  readonly format: DraftFormat;
  readonly experienceTier: ExperienceTier;
  readonly stakeTier: number;
  readonly entryFeeCents: number;
  readonly payoutTable: PrizeTable | null;
  readonly teamCount: number;
  readonly medianGame: boolean;
  readonly rosterSlots: readonly RosterSlotConfig[];
  readonly filledTeams: number;
  readonly kickoffAt: Date;
  readonly startTrigger: "scheduled" | "when_full";
  readonly kickoffRolls: number;
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
  heldSeatsByLeagueId: ReadonlyMap<string, number>,
  now: string,
): PublicLeagueSummary {
  const weights = weightsByLeagueId.get(row.id);
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    experienceTier: row.experienceTier,
    stakeTier: row.stakeTier,
    entryFeeCents: row.entryFeeCents,
    // `null`, never absent: the disclosure test pins the wire's exact key set, and a free
    // league's "no table" is a stated fact, not a missing one.
    payoutTable: row.payoutTable ?? null,
    teamCount: row.teamCount,
    filledTeams: row.filledTeams,
    scoringLabel: weights === undefined ? "Custom" : describeScoring(weights),
    compositionCategory: compositionCategoryFor(tierCompositionFor({ newcomers: row.newcomers, veterans: row.veterans })),
    draftAt: formatDraftTime(row.kickoffAt.toISOString(), now),
    // The raw instant beside its prose sibling, for the ledger card's ticking clock
    // (`draftAtIso`, `@/matchmaking/contract`) — the third sanctioned read-only
    // league-service diff of Phase 3.7 (controller ruling; the other two are
    // `proof.ts`'s min-kickoff query and `wire.ts`). Projection only: no new query,
    // no write, no lock.
    draftAtIso: row.kickoffAt.toISOString(),
    medianGame: row.medianGame,
    startTrigger: row.startTrigger,
    houseRung,
    heldSeats: heldSeatsByLeagueId.get(row.id) ?? 0,
    rosterSummary: rosterSummaryFor(row.rosterSlots),
    playoffWeeks: PLAYOFF_WEEKS,
    kickoffRolls: row.kickoffRolls,
  };
}

/**
 * The whole browse read (Phase 3.5 addendum, Task 14): the member list, off `browseQuery`, and
 * the house shelf, off `houseShelfQuery` — two queries answering two different promises
 * (`BrowseBody`'s own docblock), never one list a `houseRung` sort key folds together. Both run
 * before the scoring lookup and the held-seats lookup (Phase 3.6, Task 6), each batched over the
 * combined id set, so a page with both a shelf and a list still costs exactly FOUR queries total
 * — not two-per-half, and not a fifth for holds — the same "one extra, trivially indexed query"
 * discipline `scoringWeightsByLeagueId`'s own docblock already holds `browseQuery` alone to.
 */
/** The one-league read the hold interstitial (`/join/[leagueId]/hold`) renders from (Phase 3.6,
 *  Task 6) — the league's own facts a signed-out visitor sees while a seat is held for them. */
export interface PublicLeaguePreview {
  readonly id: string;
  readonly name: string;
  readonly teamCount: number;
  readonly filledTeams: number;
  readonly heldSeats: number;
  readonly draftAt: string;
  readonly startTrigger: "scheduled" | "when_full";
  readonly houseRung: HouseRungName | null;
}

/**
 * A single league, by id, for the hold interstitial — never a card `listPublicLeagues`'s own
 * narrowing (open-seat `HAVING`, `maxResults`) could hide a visitor's OWN league behind: this
 * page is reached holding that exact id, not discovered by scanning a list, so it answers
 * regardless of whether the league would still appear on `/browse` right now.
 *
 * `null` for a private league OR a missing one — the identical collapse
 * `publicJoinPrecondition`'s own `NOT_PUBLIC` docblock argues for, so a 404 built on this can
 * never tell a caller "this id names a real, private league" apart from "no such league".
 */
export async function publicLeaguePreview(db: Db, leagueId: string, clock: Clock = systemClock): Promise<PublicLeaguePreview | null> {
  const now = clock.now();
  const [row] = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      teamCount: leagues.teamCount,
      isPublicMatchmade: leagues.isPublicMatchmade,
      houseRung: leagues.houseRung,
      kickoffAt: drafts.kickoffAt,
      startTrigger: drafts.startTrigger,
    })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .where(eq(leagues.id, leagueId));
  if (row === undefined || !row.isPublicMatchmade) return null;

  const filled = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, leagueId));
  const heldByLeagueId = await heldSeatsByLeagueId(db, [leagueId], now);
  return {
    id: row.id,
    name: row.name,
    teamCount: row.teamCount,
    filledTeams: filled.length,
    heldSeats: heldByLeagueId.get(row.id) ?? 0,
    draftAt: formatDraftTime(row.kickoffAt.toISOString(), now),
    startTrigger: row.startTrigger,
    houseRung: row.houseRung as HouseRungName | null,
  };
}

export async function listPublicLeagues(
  db: Db,
  filter: BrowseFilter,
  clock: Clock = systemClock,
  // Phase 3.6, Task 5, Step 4: appended AFTER `clock`, not before it — every existing 3-argument
  // caller (`browse.test.ts`'s own clock-injecting tests among them) keeps its exact positional
  // meaning, and only a caller that actually wants the sort pill or the when-full toggle adds a
  // fourth argument.
  options: BrowseQueryOptions = {},
): Promise<BrowseBody> {
  // ONE instant for the shelf's own staleness predicate and for every card's rendered
  // `draftAt` — read once, so a league cannot be judged not-yet-started by one and
  // already-past by the other.
  const now = clock.now();
  const memberRows = await browseQuery(db, filter, options);
  const houseRows = await houseShelfQuery(db, now);
  const ids = [...memberRows, ...houseRows].map((row) => row.id);
  const weightsByLeagueId = await scoringWeightsByLeagueId(db, ids);
  const heldByLeagueId = await heldSeatsByLeagueId(db, ids, now);
  return {
    leagues: memberRows.map((row) => summarizeRow(row, null, weightsByLeagueId, heldByLeagueId, now)),
    house: houseRows.map((row) => summarizeRow(row, row.houseRung as HouseRungName, weightsByLeagueId, heldByLeagueId, now)),
  };
}
