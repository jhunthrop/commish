import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Db } from "./client";
import { createTestDb, truncateAll, truncateMoneyTables } from "./test-db";
import {
  auditEvents,
  draftActions,
  leagues,
  lineupSlots,
  matchups,
  moneyEntries,
  moneyTransactions,
  rosterSlots,
  teams,
  MONEY_DIRECTIONS,
  MONEY_TXN_KINDS,
} from "./schema";
import { explainPlan, findNode, indexScanNode, nodeTypes, planCost, planUsesSeqScanOn, sequentiallyScannedRelations } from "./explain";
import { LEAGUE_COUNT, TEAMS_PER_LEAGUE, USER_COUNT, seedRealisticCorpus, seedTradeCorpus } from "./test-corpus";
import { chatPageQuery } from "@/chat-service/chat";
import { dueDraftsQuery } from "@/draft-service/auto-start";
import { dueMockRoomsQuery } from "@/mock-draft-service/driver";
import { listOpenMockRoomsQuery } from "@/mock-draft-service/lobby";
import { liveDraftsQuery } from "@/draft-service/live-drafts";
import { openQuestionsQuery, pendingFlagQuery } from "@/integrity-service/flags";
import { signalsForUsersQuery } from "@/integrity-service/session-signals";
import { completedSeasonsQuery } from "@/league-service/participation";
import { browseQuery, houseShelfQuery } from "@/league-service/browse";
import { openHouseLeaguesQuery } from "@/league-service/house-factory";
import { leaguesNeedingAutoSetQuery } from "@/league-service/auto-lineup";
import { ENFORCED_LEAGUE_SQL } from "@/league-service/enforcement";
import { dueUnfilledScheduledDraftsQuery } from "@/league-service/roll";
import { leaguesFilledQuery, roomsFillingQuery, tightestRoomQuery } from "@/league-service/proof";
import { tradesQuery } from "@/league-service/trades";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { reviewAggregateQuery } from "@/review-service/reviews";
import { AUDIT_EVENT_TYPES } from "@/domain/audit";
import { MONEY_ACCOUNT_KINDS } from "@/money/accounts";

const db = createTestDb();

/**
 * A small house-shelf sample, layered on top of `seedRealisticCorpus`'s 5,000 member leagues
 * (Phase 3.5 addendum, Task 14) — a handful of house rows against thousands of member ones, the
 * realistic proportion `leagues_house_rung_idx`'s own partial predicate exists for.
 *
 * `kickoff_at` is seeded in the EXACT REVERSE of `created_at` — league 1 created first but
 * kicking off last, league 8 created last but kicking off first — the one shape that would catch
 * a regression back to sorting the shelf by the index's own `created_at` column instead of the
 * kickoff a visitor actually cares about. No `teams` rows: every house league here is empty, so
 * `HAVING count(teams.id) < team_count` holds trivially and every row is a shelf candidate.
 */
async function seedHouseShelfSample(db: Db): Promise<void> {
  await db.execute(sql`
    INSERT INTO leagues (id, name, format, team_count, stake_tier, is_public_matchmade, experience_tier, commissioner_user_id, house_rung, created_at)
    SELECT 'house_shelf_' || g,
           'House Shelf ' || g,
           'snake'::draft_format,
           12, 0, true, 'experienced'::experience_tier, NULL,
           (ARRAY['open_12', 'beginner_12'])[1 + (g % 2)],
           now() - (g || ' hours')::interval
    FROM generate_series(1, 8) g
  `);
  await db.execute(sql`
    INSERT INTO drafts (id, league_id, format, status, kickoff_at)
    SELECT 'house_shelf_' || g || '_draft', 'house_shelf_' || g, 'snake'::draft_format, 'scheduled'::draft_status,
           now() + ((9 - g) || ' hours')::interval
    FROM generate_series(1, 8) g
  `);
  await db.execute(sql`ANALYZE leagues, drafts`);
}

/**
 * Phase 3.6, Task 7 (the founder's "roll until full" ruling). `seedRealisticCorpus` gives every
 * league exactly `TEAMS_PER_LEAGUE` (3) real teams against a `team_count` of 12, so EVERY one of
 * its ~50 due leagues (`DRAFT_DUE_INTERVAL`) is short a seat — a corpus that never has a full due
 * room would measure only that the seat-count predicate always empties the result, nothing about
 * its OWN selectivity. This layers a full room onto TWO of those due leagues (`lg100`, `lg200`)
 * by filling their remaining nine seats, the same "small sample beside the big corpus" shape
 * `seedHouseShelfSample` above already uses. The user ids are shifted by a constant the original
 * `t=1..3` teams never reach (`teams_league_user_idx`'s own uniqueness — one team per user per
 * league), so no insert collides with the seats `seedRealisticCorpus` already wrote.
 */
async function seedFullDueLeagueSample(db: Db): Promise<void> {
  await db.execute(sql`
    INSERT INTO teams (id, league_id, user_id, name)
    SELECT 'tmfull' || lg || '_' || t, 'lg' || lg, 'u' || (1 + ((lg * 7 + t + 100) % 200)), 'Team ' || t
    FROM unnest(ARRAY[100, 200]) AS lg, generate_series(4, 12) AS t
  `);
  await db.execute(sql`ANALYZE teams`);
}

/** Only a `reviews`-owning proof-stats read needs this table, so it stays a small, dedicated
 *  corpus layered on top of `seedRealisticCorpus` rather than a fifth builder in `@/db/
 *  test-corpus` — the same "small sample beside the big corpus" shape `seedHouseShelfSample`
 *  above already uses. */
const REVIEW_COUNT = 5_000;
/** One review in every this-many is removed — rare, the same "small realistic fraction of a
 *  rare state" ratio `test-corpus.ts`'s own `OPEN_FLAG_INTERVAL` uses, and selective enough that
 *  `reviews_feed_idx`'s partial predicate (`removed_at IS NULL`) is worth having. */
const REMOVED_REVIEW_INTERVAL = 100;

/**
 * `proofStats`' own rating aggregate needs SOME reviews to measure `reviewAggregateQuery`
 * against — `seedRealisticCorpus` seeds none, because nothing read `reviews` before this task.
 * A dedicated `users` slice (`revu1`..`revu{REVIEW_COUNT}`), not `seedRealisticCorpus`'s own
 * `u1`..`u200`: `reviews_user_idx` is UNIQUE on `user_id`, so 5,000 reviews need 5,000 distinct
 * authors, comfortably past the 200 the general corpus already holds.
 */
async function seedReviewCorpus(db: Db): Promise<void> {
  await db.execute(sql`
    INSERT INTO users (id, email, display_name)
    SELECT 'revu' || g, 'revu' || g || '@example.test', 'Reviewer ' || g
    FROM generate_series(1, ${REVIEW_COUNT}) g
  `);
  await db.execute(sql`
    INSERT INTO reviews (id, user_id, rating, body, created_at, removed_at, removed_by_user_id, removal_reason)
    SELECT 'rev' || g, 'revu' || g, 1 + (g % 5),
           'A generic review body, long enough to clear the twenty character minimum with room to spare.',
           now() - (g || ' minutes')::interval,
           CASE WHEN g % ${REMOVED_REVIEW_INTERVAL} = 0 THEN now() ELSE NULL END,
           CASE WHEN g % ${REMOVED_REVIEW_INTERVAL} = 0 THEN 'revu' || g ELSE NULL END,
           CASE WHEN g % ${REMOVED_REVIEW_INTERVAL} = 0 THEN 'other' ELSE NULL END
    FROM generate_series(1, ${REVIEW_COUNT}) g
  `);
  await db.execute(sql`ANALYZE reviews`);
}

/** Phase 4, Task 2's money book: enough history that the planner has a real choice to make. */
const MONEY_ACCOUNT_COUNT = 2_000;
const MONEY_TXN_COUNT = 6_000;
/** One transaction in this many belongs to a league (an entry fee); the rest are deposits with
 *  `league_id` NULL — the realistic proportion once money is live, external motion dwarfing fees. */
const MONEY_LEAGUE_TXN_INTERVAL = 3;
const MONEY_LEAGUE_COUNT = 100;

/**
 * Phase 4, Task 2 (migration 0035): the money book's own corpus, layered beside the others in the
 * same "small sample beside the big corpus" shape — except money's tables are NEW, so this is
 * their whole population: 2,000 member accounts plus the pool singleton, 6,000 transactions, two
 * balanced legs each (12,000 entries) spread over four tax years and eight states. The spreads
 * are what give every predicate below real selectivity to measure: one account owns ~12 of
 * 12,000 entries, one `(tax_year, state)` pair ~375, one league ~20 of 6,000 transactions.
 */
async function seedMoneyCorpus(db: Db): Promise<void> {
  // `truncateAll` deliberately does not name the money tables yet (`truncateMoneyTables`' own
  // docblock carries the pgbouncer reason and the merge cleanup) — cleared here so a rerun
  // against the same lane database never collides with its own previous corpus.
  await truncateMoneyTables(db);
  await db.execute(sql`
    INSERT INTO money_accounts (id, kind, owner_id, balance_cents)
    SELECT 'user_available:mu' || g, 'user_available'::money_account_kind, 'mu' || g, 1000
    FROM generate_series(1, ${MONEY_ACCOUNT_COUNT}) g
  `);
  await db.execute(sql`INSERT INTO money_accounts (id, kind, owner_id, balance_cents) VALUES ('fbo_pool', 'fbo_pool', NULL, ${MONEY_ACCOUNT_COUNT * 1000})`);
  await db.execute(sql`
    INSERT INTO money_transactions (id, kind, league_id, created_at)
    SELECT 'mtx' || g,
           CASE WHEN g % ${MONEY_LEAGUE_TXN_INTERVAL} = 0 THEN 'entry_fee'::money_txn_kind ELSE 'deposit'::money_txn_kind END,
           CASE WHEN g % ${MONEY_LEAGUE_TXN_INTERVAL} = 0 THEN 'mlg' || (g % ${MONEY_LEAGUE_COUNT}) ELSE NULL END,
           now() - (g || ' minutes')::interval
    FROM generate_series(1, ${MONEY_TXN_COUNT}) g
  `);
  await db.execute(sql`
    INSERT INTO money_entries (id, transaction_id, account_id, direction, amount_cents, state_of_entry, tax_year, created_at)
    SELECT 'men' || g || '_' || leg,
           'mtx' || g,
           CASE WHEN leg = 1 THEN 'fbo_pool' ELSE 'user_available:mu' || (1 + g % ${MONEY_ACCOUNT_COUNT}) END,
           CASE WHEN leg = 1 THEN 'debit'::money_direction ELSE 'credit'::money_direction END,
           500,
           (ARRAY['NJ', 'NY', 'PA', 'IL', 'OH', 'MI', 'GA', 'VA'])[1 + g % 8],
           2023 + g % 4,
           now() - (g || ' minutes')::interval
    FROM generate_series(1, ${MONEY_TXN_COUNT}) g, generate_series(1, 2) leg
  `);
  await db.execute(sql`ANALYZE money_accounts, money_transactions, money_entries`);
}

/**
 * Migration 0038 — a cross-lane carry from the design lane's Task 8 review (MEDIUM: unproven
 * index coverage). The design lane's wire (`@/league-service/wire.ts`, merged to `main` on
 * `worktree-phase3p7-design-v3`, not present in THIS worktree — read via `git show main:src/
 * league-service/wire.ts`) reads `audit_events` by `event_type = 'member_joined'` and an
 * `occurred_at` window, INNER JOINed to `leagues`, with NO `league_id` EQUALITY anywhere in its
 * own `WHERE`: the join supplies `league_id` per outer row, never as one literal value the
 * existing `audit_events_league_occurred_idx` (`league_id, occurred_at`) could seek on the way an
 * equality predicate would. `audit_events_actor_type_occurred_idx` (`actor_id, event_type,
 * occurred_at`) needs an equality on `actor_id` first, which this read never supplies either — an
 * anonymous surface has no business filtering on who claimed a seat (wire.ts's own S9 note). Ten
 * thousand leagues' worth of history and neither existing composite leads with the two columns
 * this read actually filters on.
 *
 * `AUDIT_EVENT_TYPES`' own catalog spelling (`member_joined`) is reused rather than a string
 * literal borrowed from a file this worktree cannot import.
 *
 * THE CORPUS. Reproduces the shape at realistic scale rather than trusting the reasoning above.
 * `OTHER_AUDIT_EVENTS_PER_LEAGUE` (12) non-`member_joined` rows per league — draft picks and
 * lineup changes, the bulk of a real audit history — spread across `AUDIT_HISTORY_DAYS` (180) so
 * `audit_events` is a genuinely large table (75,000 rows over `LEAGUE_COUNT` leagues) with a long
 * tail behind it, not a toy sized to fit the query under test. `member_joined` gets `TEAMS_PER_
 * LEAGUE` (3) rows per league — the seats a 3-team corpus league actually fills — keyed on `g %
 * AUDIT_HISTORY_DAYS`: every league whose day-offset lands on exactly 0 joined WITHIN the wire's
 * 24-hour window (`now() - 0 days - a few minutes`), everyone else joined further back across the
 * six-month tail. `AUDIT_HISTORY_DAYS` (180) is itself a multiple of 10, so every such league is
 * automatically `is_public_matchmade` too (`seedRealisticCorpus`'s own `g % 10 = 0` rule) — the
 * exact "recent, public claim" shape the wire exists to surface, arrived at by the corpus's own
 * arithmetic rather than a second hand-picked list of league ids. One join in twenty is stamped a
 * release (`payload.outcome: 'seat_released'`), so the corpus exercises `NOT_A_SEAT_RELEASE`'s
 * own predicate (copied below, verbatim, from wire.ts's own comment) rather than leaving it
 * permanently vacuous.
 */
const AUDIT_HISTORY_DAYS = 180;
const OTHER_AUDIT_EVENTS_PER_LEAGUE = 12;

async function seedWireClaimsAuditSample(db: Db): Promise<void> {
  // The long tail: non-`member_joined` history, scattered across the full six-month window so
  // the table's own size and age spread are realistic, not shaped around the query under test.
  await db.execute(sql`
    INSERT INTO audit_events (event_id, chain_scope, sequence, event_type, actor_id, actor_type, league_id, payload, occurred_at, previous_event_hash, event_hash, hash_version)
    SELECT
      'aeflr' || g || '_' || n,
      'lg' || g,
      n,
      (ARRAY['draft_pick', 'lineup_change'])[1 + (n % 2)]::audit_event_type,
      'u' || (1 + ((g * 7 + n) % ${USER_COUNT})),
      'user'::audit_actor_type,
      'lg' || g,
      '{}'::jsonb,
      now() - (((g * 13 + n * 7) % ${AUDIT_HISTORY_DAYS}) || ' days')::interval - (((g + n) % 1440) || ' minutes')::interval,
      'h', 'haeflr' || g || '_' || n, 1
    FROM generate_series(1, ${LEAGUE_COUNT}) g, generate_series(1, ${OTHER_AUDIT_EVENTS_PER_LEAGUE}) n
  `);
  // The claims: `TEAMS_PER_LEAGUE` seats per league, day-offset `g % AUDIT_HISTORY_DAYS` — see
  // this function's own docblock for why day-offset 0 lands exactly the wire's public, in-window
  // slice without a second hand-picked league list.
  await db.execute(sql`
    INSERT INTO audit_events (event_id, chain_scope, sequence, event_type, actor_id, actor_type, league_id, payload, occurred_at, previous_event_hash, event_hash, hash_version)
    SELECT
      'aemj' || g || '_' || t,
      'lg' || g,
      ${OTHER_AUDIT_EVENTS_PER_LEAGUE} + t,
      'member_joined'::audit_event_type,
      'u' || (1 + ((g * 11 + t) % ${USER_COUNT})),
      'user'::audit_actor_type,
      'lg' || g,
      CASE WHEN (g + t) % 20 = 0 THEN jsonb_build_object('outcome', 'seat_released') ELSE '{}'::jsonb END,
      now() - ((g % ${AUDIT_HISTORY_DAYS}) || ' days')::interval - ((t * 3) || ' minutes')::interval,
      'h', 'haemj' || g || '_' || t, 1
    FROM generate_series(1, ${LEAGUE_COUNT}) g, generate_series(1, ${TEAMS_PER_LEAGUE}) t
  `);
  await db.execute(sql`ANALYZE audit_events`);
}

describe("hot read paths use indexes", () => {
  beforeAll(async () => {
    await truncateAll(db);
    await seedRealisticCorpus(db);
    await seedHouseShelfSample(db);
    await seedFullDueLeagueSample(db);
    await seedReviewCorpus(db);
    await seedMoneyCorpus(db);
    await seedWireClaimsAuditSample(db);
  }, 120_000);

  // `teams` is deliberately not asserted here: at this corpus size, the planner's genuine
  // cost-based choice is a sequential scan of `teams` hashed once against ~500 matching
  // leagues, cheaper than ~1,500 individual index lookups. `teams_league_id_idx` — the index
  // this join could use — is NOT exercised by any plan test in this file: "a user's teams are
  // found by index" below covers a different index, `teams_user_id_idx`, via a different query
  // (`WHERE user_id = ...`, no join). See docs/decisions/data-layer-hardening.md for the
  // `enable_seqscan = off` diagnostic that confirmed the `teams_league_id_idx` path exists at all.
  it("public browse does not sequential-scan leagues", async () => {
    const plan = await explainPlan(db, browseQuery(db, EMPTY_BROWSE_FILTER));
    expect(sequentiallyScannedRelations(plan)).not.toContain("leagues");
  });

  it("a narrowed browse also avoids a sequential scan of leagues", async () => {
    const plan = await explainPlan(
      db,
      browseQuery(db, { format: "auction", experienceTier: "experienced", stakeTier: 3, participationTier: "any" }),
    );
    expect(sequentiallyScannedRelations(plan)).not.toContain("leagues");
  });

  /**
   * PHASE 3 PLAN D, TASK 2. The composition join (`newcomers`/`veterans`, folded into
   * `browseQuery` itself — `browse.ts`'s own docblock) measured over the SAME 5,000-league
   * realistic corpus every assertion in this `describe` block builds from, per the brief's own
   * Step 2: "the composition is a `GROUP BY` folded into `browseQuery`'s existing `leftJoin
   * (teams)`... and that join is the one this task must measure rather than assume."
   *
   * `leagues_public_browse_idx` still leads the plan — the `LATERAL` join computing each seat's
   * own completed-season count is a SCALAR per outer row, not a fan-out, so it changes the shape
   * of the plan below the `GROUP BY` without changing which index the planner uses to find the
   * candidate leagues in the first place.
   */
  it("plans the browse query with the composition join and still uses leagues_public_browse_idx", async () => {
    const plan = await explainPlan(db, browseQuery(db, EMPTY_BROWSE_FILTER));
    expect(sequentiallyScannedRelations(plan)).not.toContain("leagues");
    expect(indexScanNode(plan, "leagues_public_browse_idx")).toBeDefined();
    // The composition join runs on EVERY browse, narrowed or not — `compositionCategory` is a
    // display field, not only a filter — so the default, unnarrowed path already exercises
    // `leagues_season_completed_idx` too. See "DOES choose leagues_season_completed_idx" below
    // for the full account of why.
    expect(indexScanNode(plan, "leagues_season_completed_idx")).toBeDefined();
  });

  /**
   * PHASE 3.5, TASK 8, STEP 4. `browseQuery` used to order by `created_at` alone; it now orders
   * by seats-remaining ASC first, `created_at` ASC as the tiebreaker — the task's own cost claim,
   * measured rather than asserted: the plan is `Limit -> Sort -> HashAggregate -> ...` either
   * way (`leagues.ts`'s `leagues_public_browse_idx` docblock), so the sort runs AFTER the
   * aggregation regardless of what it sorts by, and changing the sort key costs nothing the
   * unsorted plan wasn't already paying.
   *
   * The `"Sort Key"` assertion is the mutation proof: `nodeTypes` alone can only see THAT a Sort
   * node exists, not WHAT it sorts by, so a regression back to a bare `asc(leagues.createdAt)`
   * would leave every OTHER assertion in this file green while silently undoing Step 4. This one
   * reddens on exactly that mutation.
   */
  it("plans the seats-remaining ordering as a Sort after the HashAggregate, and still uses leagues_public_browse_idx", async () => {
    const plan = await explainPlan(db, browseQuery(db, EMPTY_BROWSE_FILTER));
    expect(sequentiallyScannedRelations(plan)).not.toContain("leagues");
    expect(indexScanNode(plan, "leagues_public_browse_idx")).toBeDefined();

    const outerSort = findNode(plan, (node) => node["Node Type"] === "Sort" && (node["Sort Key"]?.length ?? 0) >= 2);
    expect(outerSort).toBeDefined();
    expect(outerSort?.["Sort Key"]?.[0]).toContain("team_count");
    expect(outerSort?.["Sort Key"]?.[0]).toContain("count(teams.id)");
    expect(outerSort?.["Sort Key"]?.[1]).toBe("leagues.created_at");

    // The HashAggregate (or, at a corpus small enough for a Sorted strategy, an Aggregate
    // fed by its own Sort) sits BELOW the outer Sort in the tree — i.e. runs first — which is
    // the property that makes the sort key free to change at all.
    const types = nodeTypes(plan);
    expect(types.indexOf("Limit")).toBeLessThan(types.indexOf("Sort"));
    expect(types.some((type) => type === "HashAggregate" || type === "Aggregate")).toBe(true);
  });

  /**
   * PHASE 3.5 ADDENDUM, TASK 14, STEP 2. The house shelf's own query, measured separately from
   * the member list's: `leagues_house_rung_idx`'s partial predicate (`house_rung IS NOT NULL`)
   * matches `houseShelfQuery`'s own `WHERE` exactly, the identical reasoning
   * `leagues_season_completed_idx`'s own consumer note carries, so the planner answers with an
   * index scan rather than a sequential scan of 5,008 rows to find the 8 that qualify.
   */
  it("the house shelf reads leagues_house_rung_idx, never a sequential scan of leagues", async () => {
    const plan = await explainPlan(db, houseShelfQuery(db, new Date().toISOString()));
    expect(sequentiallyScannedRelations(plan)).not.toContain("leagues");
    expect(indexScanNode(plan, "leagues_house_rung_idx")).toBeDefined();
  });

  /**
   * LOW (wave-1 review): the missing counterpart to the shelf's own assertion above.
   * `openHouseLeaguesQuery` (`@/league-service/house-factory.ts`) is the reconciler's own count —
   * both the shortfall side (`ensureHouseCatalog`) and the retirement side
   * (`retirementCandidates`) read it — and it is scoped to `leagues.house_rung = rung` the
   * identical way `houseShelfQuery` is, so it earns the identical index proof: an index scan on
   * `leagues_house_rung_idx`, never a sequential scan of the 5,000+ member leagues this rung's
   * handful of house rows sit among.
   */
  it("the reconciler's own open-count (openHouseLeaguesQuery) reads leagues_house_rung_idx too, never a sequential scan of leagues", async () => {
    const plan = await explainPlan(db, openHouseLeaguesQuery(db, "open_12", new Date().toISOString()));
    expect(sequentiallyScannedRelations(plan)).not.toContain("leagues");
    expect(indexScanNode(plan, "leagues_house_rung_idx")).toBeDefined();
  });

  /**
   * THE MEASUREMENT THIS TASK'S BINDING CONTEXT DEMANDED: an earlier draft of both
   * `leagues_house_rung_idx`'s own docblock (`schema.ts`) and `houseShelfQuery`'s assumed the
   * shelf could read its ordering straight off the index's second column (`created_at`), on the
   * (false, across rungs) belief that creation order and soonest-draft order coincide. They do
   * not: `seedHouseShelfSample`'s own corpus seeds `kickoff_at` in the EXACT REVERSE of
   * `created_at`, so a plan that still sorted by `created_at` would rank these leagues backwards.
   * The mutation proof is the `"Sort Key"` assertion itself — `nodeTypes` alone can only see THAT
   * a `Sort` node exists, not WHAT it sorts by, so a regression back to trusting the index's own
   * column order would leave every other assertion in this describe block green while silently
   * shipping the wrong shelf.
   */
  it("sorts the shelf by drafts.kickoff_at, never by leagues_house_rung_idx's own created_at column", async () => {
    const plan = await explainPlan(db, houseShelfQuery(db, new Date().toISOString()));
    const sort = findNode(plan, (node) => node["Node Type"] === "Sort" && (node["Sort Key"]?.length ?? 0) >= 1);
    expect(sort).toBeDefined();
    expect(sort?.["Sort Key"]?.[0]).toBe("drafts.kickoff_at");

    const shelf = await houseShelfQuery(db, new Date().toISOString());
    expect(shelf.map((row) => row.id)).toEqual([
      "house_shelf_8", "house_shelf_7", "house_shelf_6", "house_shelf_5",
      "house_shelf_4", "house_shelf_3", "house_shelf_2", "house_shelf_1",
    ]);
  });

  /**
   * A participation-narrowed browse (the `HAVING` predicate built from the SAME composition
   * join) is the query that changed shape the most, so it gets its own measurement rather than
   * inheriting the unnarrowed case's proof by assumption.
   */
  it("a participation-narrowed browse still uses leagues_public_browse_idx, never a sequential scan", async () => {
    const plan = await explainPlan(db, browseQuery(db, { ...EMPTY_BROWSE_FILTER, participationTier: "veteran" }));
    expect(sequentiallyScannedRelations(plan)).not.toContain("leagues");
    expect(indexScanNode(plan, "leagues_public_browse_idx")).toBeDefined();
  });

  /**
   * THE MEASUREMENT THE CONTROLLER RULING TURNS ON, and the surprise in it. Task 1's review
   * flagged `leagues_season_completed_idx` as an index with no consumer named anywhere in the
   * plan, and predicted Task 2's composition join would reach `leagues` by PRIMARY KEY and never
   * choose it — the same reasoning `completedSeasonsQuery`'s own plan proves for the per-account
   * read (a plain `INNER JOIN … WHERE season_completed_at IS NOT NULL`, filtered AFTER the join
   * rather than as part of it).
   *
   * `seatCompletedSeasonsQuery` (`browse.ts`) is shaped differently, and the difference is what
   * flips the answer: `season_completed_at IS NOT NULL` rides in the `LEFT JOIN`'s own `ON`
   * clause (`and(eq(seatLeagues.id, seatTeams.leagueId), isNotNull(seatLeagues.seasonCompletedAt))`
   * — the SAME shape Task 1's now-deleted `memberCompletedSeasonsQuery` used for the per-league
   * `leagueTierComposition` this task's fix round removed as a dead, never-called helper), not a
   * `WHERE` applied after. That is EXACTLY the partial index's own predicate, so the planner
   * answers "does a completed league with this id exist"
   * with an `Index Only Scan` on `leagues_season_completed_idx` rather than a primary-key lookup
   * plus a heap fetch to check the column — measured here at 4,500 loops (one per candidate seat
   * before the `HAVING`/`LIMIT` ever runs), each an index-only point lookup rather than a heap
   * fetch. The index has a real consumer after all: not the per-account read Task 1 shipped it
   * beside, but the composition join this task adds. No drop migration ships.
   */
  it("DOES choose leagues_season_completed_idx — the composition join's ON clause matches the partial predicate exactly", async () => {
    const plan = await explainPlan(db, browseQuery(db, { ...EMPTY_BROWSE_FILTER, participationTier: "veteran" }));
    const usedIndex = indexScanNode(plan, "leagues_season_completed_idx");
    expect(usedIndex).toBeDefined();
    expect(usedIndex?.["Node Type"]).toBe("Index Only Scan");
  });

  it("a user's teams are found by index, not by scanning every team", async () => {
    const query = db.select({ leagueId: teams.leagueId, teamId: teams.id }).from(teams).where(eq(teams.userId, "u7"));
    expect(sequentiallyScannedRelations(await explainPlan(db, query))).not.toContain("teams");
  });

  /**
   * PHASE 3 PLAN D, TASK 7 REVIEW FIX ROUND 1 (F3). `autoStartDueDrafts`'s (`@/draft-service/
   * auto-start`) own scan, `dueDraftsQuery` — the ticker's SECOND reader of `drafts_status_idx`
   * (`schema.ts`), run on every instance every tick whether or not a draft is due. Measured over
   * the SAME corpus every other assertion in this block builds from, now that `seedRealisticCorpus`
   * gives `drafts.status` a real split (`DRAFT_LIVE_INTERVAL`/`DRAFT_SCHEDULED_INTERVAL`,
   * `@/db/test-corpus`) instead of every row reading `scheduled` — a corpus with zero selectivity
   * on the column under test would have measured nothing.
   *
   * THE MEASUREMENT DECIDED, per the standing rule (`drizzle/0029_draft_due_scan_index.sql` has
   * the full account): with the ORIGINAL single-column `drafts_status_idx`, this query's plan was
   * a Bitmap Index Scan finding every `scheduled` row, then a Bitmap Heap Scan applying
   * `kickoff_at <= now()` as a `Filter` AFTER the fetch — discarding 450 of 495 rows (91%) in this
   * corpus, uncapped by `maxDraftsPerTick` because the `ORDER BY id` sorts the full result before
   * the `LIMIT` ever applies. `kickoff_at` shipped as the index's second column, so the
   * `(status, kickoff_at)` half of this query's own `Index Cond` still covers both predicates —
   * asserted below exactly as it always was.
   *
   * PHASE 3.6, TASK 7 (the founder's "roll until full" ruling). This query gained a THIRD
   * predicate — a correlated seat count, `roomIsFull`'s own rule expressed in SQL
   * (`@/matchmaking/roll`) — that Postgres cannot fold into the composite index the way it folds
   * `status`/`kickoff_at`: it depends on `teams` and `leagues.team_count`, neither of which
   * `drafts_status_idx` carries. `(status, kickoff_at)` still does every bit of the narrowing
   * work it always did — asserted below exactly as it always was, and the "drafts" node itself
   * STILL carries no `Filter` (0 rows removed there, unchanged from before this predicate
   * existed). MEASURED, fix round 1 LOW: the seat-count predicate itself lands as a real
   * `Filter` on the LEAGUES node instead (Postgres evaluates it once the join has `leagues.
   * team_count` and the correlated `teams` subplan available, not while still scanning
   * `drafts`) — asserted here as a BOUND (`> 0` rows removed) rather than a brittle exact count,
   * since the exact number moves with the corpus's own public-league population. On
   * `seedFullDueLeagueSample`'s own two full rooms among this corpus's forty-five
   * due-and-scheduled leagues (fifty candidates land on `g % 100 = 0`; five of those are ALSO
   * `g % 1000 = 0`, `DRAFT_LIVE_INTERVAL`'s own overlap, and read `in_progress` instead of
   * `scheduled` — the exact accounting the ORIGINAL "45 genuinely due rows" note already made),
   * this scan returns exactly the two full rooms; `dueUnfilledScheduledDraftsQuery`'s own
   * assertion below is this test's mirror image — the SAME candidate set, the OPPOSITE seat-count
   * comparison, the other forty-three rows.
   */
  it("the auto-start due-kickoff scan still seeks on (status, kickoff_at), then filters to full rooms only", async () => {
    const plan = await explainPlan(db, dueDraftsQuery(db, new Date().toISOString()));
    expect(sequentiallyScannedRelations(plan)).not.toContain("drafts");
    const usedIndex = indexScanNode(plan, "drafts_status_idx");
    expect(usedIndex).toBeDefined();
    // Both predicates are ONE index condition, not a narrow-then-filter — the composite key
    // doing its job, not merely present in the plan by name.
    expect(usedIndex?.["Index Cond"]).toContain("status");
    expect(usedIndex?.["Index Cond"]).toContain("kickoff_at");
    // The "drafts" heap fetch itself still discards nothing — unchanged from before this task.
    const draftsNode = findNode(plan, (node) => node["Relation Name"] === "drafts");
    expect(draftsNode).toBeDefined();
    expect(draftsNode?.Filter).toBeUndefined();
    expect(draftsNode?.["Rows Removed by Filter"] ?? 0).toBe(0);
    // The seat-count predicate is a real `Filter`, and it is on "leagues" — measured as a BOUND
    // (genuinely discards candidates), not an exact count pinned to this corpus's population.
    const leaguesNode = findNode(plan, (node) => node["Relation Name"] === "leagues");
    expect(leaguesNode).toBeDefined();
    expect(leaguesNode?.Filter).toContain("team_count");
    expect(leaguesNode?.["Rows Removed by Filter"] ?? 0).toBeGreaterThan(0);
    // The correctness claim itself, measured directly rather than inferred from plan shape: only
    // the two rooms `seedFullDueLeagueSample` actually filled come back.
    const rows = await dueDraftsQuery(db, new Date().toISOString());
    expect(rows).toHaveLength(2);
  });

  /**
   * Phase 3.6, Task 7: `dueUnfilledScheduledDraftsQuery`'s (`@/league-service/roll`) own scan —
   * the roll's half of the same due population `dueDraftsQuery` above now excludes. Same corpus,
   * same `(status, kickoff_at)` index condition, the OPPOSITE seat-count comparison: the
   * forty-three due-and-scheduled leagues that are NOT full (forty-five candidates minus the two
   * `seedFullDueLeagueSample` filled all the way). UNLIKE `dueDraftsQuery`, this query carries a
   * FOURTH predicate — `start_trigger = 'scheduled'` (Step 2's own model ruling: a `when_full`
   * draft has no chosen time to roll) — which `drafts_status_idx` cannot fold in either, so it is
   * a genuine `Filter` on the "drafts" node itself here (removing zero rows in THIS corpus, since
   * `seedRealisticCorpus` never sets a `when_full` trigger — the predicate is still exercised, it
   * simply has nothing to discard against this particular seed).
   */
  it("the roll's own due-unfilled scan seeks on the same index, and finds the OTHER forty-three rows", async () => {
    const plan = await explainPlan(db, dueUnfilledScheduledDraftsQuery(db, new Date().toISOString()));
    expect(sequentiallyScannedRelations(plan)).not.toContain("drafts");
    const usedIndex = indexScanNode(plan, "drafts_status_idx");
    expect(usedIndex).toBeDefined();
    expect(usedIndex?.["Index Cond"]).toContain("status");
    expect(usedIndex?.["Index Cond"]).toContain("kickoff_at");
    const draftsNode = findNode(plan, (node) => node["Relation Name"] === "drafts");
    expect(draftsNode).toBeDefined();
    expect(draftsNode?.Filter).toContain("start_trigger");
    const leaguesNode = findNode(plan, (node) => node["Relation Name"] === "leagues");
    expect(leaguesNode).toBeDefined();
    expect(leaguesNode?.Filter).toContain("team_count");
    expect(leaguesNode?.["Rows Removed by Filter"] ?? 0).toBeGreaterThan(0);
    const rows = await dueUnfilledScheduledDraftsQuery(db, new Date().toISOString());
    expect(rows).toHaveLength(43);
  });

  /**
   * FINAL REVIEW F16 — THE SECOND READER, NOW ACTUALLY MEASURED. `src/db/schema.ts` opened the
   * `drafts_status_idx` comment with "TWO READERS, MEASURED" and
   * `docs/decisions/enforcement-and-tiers.md` §9 said the other reader "measures unchanged", but
   * only the due-kickoff scan above had an assertion behind it. Against this branch's own standard
   * that is an overclaim, and the cheaper of the two fixes is the honest one: measure it.
   *
   * `liveDraftsQuery` (`@/draft-service/live-drafts`) is the sweep's expiry scan, run on every fire.
   * It reads `status = 'in_progress'` alone, which is equality on the index's LEADING column, so
   * widening the index to `(status, kickoff_at)` in migration 0029 could not have changed its plan
   * — the argument the migration comment made carefully and this assertion now makes measured.
   * Imported as the real builder, never a hand copy (F9's lesson).
   */
  it("the ticker's expiry scan still seeks on the leading status column alone — 0029's widening left it untouched", async () => {
    const plan = await explainPlan(db, liveDraftsQuery(db));
    expect(sequentiallyScannedRelations(plan)).not.toContain("drafts");
    const usedIndex = indexScanNode(plan, "drafts_status_idx");
    expect(usedIndex).toBeDefined();
    expect(usedIndex?.["Index Cond"]).toContain("status");
    // The second column takes no part: this reader names only `status`, so a plan that had begun
    // seeking on `kickoff_at` too would mean the index change reached a query it should not have.
    expect(usedIndex?.["Index Cond"]).not.toContain("kickoff_at");
  });

  /**
   * FINAL REVIEW F8 — the auto-set's driving scan, the one new scan on this branch that shipped
   * with no measurement while its sibling automation's smaller scan got migration 0029.
   *
   * `leaguesNeedingAutoSetQuery` (`@/league-service/auto-lineup`) is the LEVEL-derived candidate
   * query F2 replaced `leaguesInWeek` with: public matchmade leagues fielding this week that still
   * have a team with no `lineup_slots` row for it, bounded at `AUTO_SET_CONFIG.maxLeaguesPerRun`.
   * The old read was `SELECT DISTINCT league_id FROM matchups WHERE week_number = $1` with no
   * `LIMIT`, which the primary key (leading with `league_id`) cannot serve and
   * `matchups_unsettled_idx` (partial on `home_score IS NULL`) does not imply.
   *
   * THE MEASUREMENT DECIDED, and it decided NO NEW INDEX — stated because the opposite outcome is
   * what this file usually records. Over the 5,000-league corpus nothing is sequentially scanned
   * and the plan DRIVES off `matchups_unsettled_idx` as an Index Only Scan: the partial index
   * built for exactly this question, `(week_number, league_id) WHERE home_score IS NULL`, whose
   * predicate this query matches because of F11's settled-week guard. That guard's job is
   * correctness; matching the partial index is its side effect, and it is a large one (the
   * measured plan cost falls by an order of magnitude, because a settled league is never a
   * candidate to begin with). `leagues` is then a primary-key probe per candidate rather than a
   * walk, `teams` rides `teams_league_id_idx`, and `lineup_slots` its own primary key, index-only
   * — no heap page is touched to discover that a team already has a row for the week.
   *
   * Because the ordering comes from an index walk rather than a Sort, the `LIMIT` genuinely
   * short-circuits — the exact property `dueDraftsQuery` lacked before 0029, where `ORDER BY id`
   * sorted the whole result first. So a bound was the fix here, and an index was not; adding one
   * would be a write cost paid for a plan that is already index-only.
   *
   * TASK 6.5 (Phase 3.5) — THE `Sort` ASSERTION WAS A GENUINE FLAKE, ROOT-CAUSED. Statistics were
   * never stale: `seedRealisticCorpus`'s own `ANALYZE` already covers every table this query reads.
   * The real cause is cost-boundary bistability — at the corpus's PRIOR candidate count (10 leagues
   * matching `week_number`/`home_score IS NULL`/`is_public_matchmade` at once), the Nested Loop
   * shape this test pins (probing `leagues_pkey` once per candidate) and a competing Hash Join
   * shape (scanning all ~500 `is_public_matchmade` leagues through `leagues_public_browse_idx`
   * first) land within ~15% of each other in the planner's own cost estimate. `ANALYZE`'s sampling
   * is a genuine random reservoir sample, not a bug, so ordinary sampling noise could — rarely —
   * tip the estimate toward the Hash Join, which cannot preserve `matchups.league_id` order and so
   * adds the `Sort` this assertion refuses. `UNSETTLED_LEAGUE_INTERVAL` (`@/db/test-corpus`) is now
   * 1000 rather than 500, halving the candidate count to 5 and, with it, the Nested Loop side's
   * cost — verified decisive (never observed to cross) across 100 repeated ANALYZE/EXPLAIN cycles
   * at 100x this database's real sampling noise. See `UNSETTLED_LEAGUE_INTERVAL`'s own docblock for
   * the full account.
   */
  it("the auto-set's candidate scan drives off matchups_unsettled_idx, and its LIMIT short-circuits", async () => {
    const plan = await explainPlan(db, leaguesNeedingAutoSetQuery(db, 1));
    expect(sequentiallyScannedRelations(plan)).toEqual([]);
    // No Sort anywhere: the `ORDER BY` is served by the index walk, which is what lets the LIMIT
    // stop early instead of materializing every candidate league in the product first.
    expect(nodeTypes(plan)).not.toContain("Sort");
    expect(nodeTypes(plan)).toContain("Limit");
    // The partial index earns a second reader — it shipped for `settleMissedWeeks` alone.
    expect(indexScanNode(plan, "matchups_unsettled_idx")?.["Node Type"]).toBe("Index Only Scan");
    // The two probes that answer "does this league still owe a lineup" are index-only: no heap
    // page is touched to discover that a team already has a row for the week.
    expect(indexScanNode(plan, "lineup_slots_team_id_week_number_slot_slot_index_pk")?.["Node Type"]).toBe("Index Only Scan");
    expect(indexScanNode(plan, "teams_league_id_idx")).toBeDefined();
  });

  /**
   * THE chat page read, and it is the production builder itself (`chatPageQuery`, exported from
   * `@/chat-service/chat`), not a lookalike. Final review, HIGH 3: this used to EXPLAIN a
   * four-column, join-free, `ORDER BY id ASC` stand-in whose docblock claimed it was "the chat
   * page's own read, exactly as `listMessages` makes it… and nothing more" — false on all three
   * counts, which is how a green test came to stand over an index the real query never used.
   */
  it("a chat page seeks straight to its league's range, rather than scanning the primary key and discarding", async () => {
    const plan = await explainPlan(db, chatPageQuery(db, { leagueId: "lg7" }));
    expect(sequentiallyScannedRelations(plan)).not.toContain("chat_messages");
    // Avoiding a Seq Scan is not the property. WITHOUT `chat_messages_league_id_idx` the planner
    // falls back to a backward Index Scan on `chat_messages_pkey` with
    // `Filter: (league_id = ...)`, discarding every other league's rows on the way — a ratio that
    // gets worse with every message the product ever stores. So: pin the index BY NAME, and
    // assert nothing was discarded, which is the signature of exactly that fallback.
    const usedIndex = indexScanNode(plan, "chat_messages_league_id_idx");
    expect(usedIndex).toBeDefined();
    expect(usedIndex?.["Rows Removed by Filter"] ?? 0).toBe(0);
    // And the index's SECOND key is doing its job: `ORDER BY id DESC` is served by walking the
    // index backward, not by sorting what it returned. Drop `id` from the index and this is the
    // assertion that reddens.
    expect(nodeTypes(plan)).not.toContain("Sort");
    expect(nodeTypes(plan)).not.toContain("Incremental Sort");
  });

  /**
   * The cursor page, which is what backward pagination actually issues and what nothing measured
   * before. `id < $2` narrows the same index range rather than adding a Filter on top of it.
   */
  it("pages backwards through a league's history on the same index, still without discarding", async () => {
    const plan = await explainPlan(db, chatPageQuery(db, { leagueId: "lg7", before: "150" }));
    const usedIndex = indexScanNode(plan, "chat_messages_league_id_idx");
    expect(usedIndex).toBeDefined();
    expect(usedIndex?.["Rows Removed by Filter"] ?? 0).toBe(0);
    // Both halves of the cursor are an Index Cond. `id < $2` landing as a `Filter` instead would
    // mean re-walking the league's whole history on every page back.
    expect(usedIndex?.["Index Cond"]).toContain("league_id");
    expect(usedIndex?.["Index Cond"]).toContain("id <");
    expect(usedIndex?.Filter).toBeUndefined();
  });

  it("a draft's action log replays by index", async () => {
    await db.execute(sql`
      INSERT INTO draft_actions (draft_id, sequence, action, timestamp)
      SELECT 'df1', g, '{"v":1,"type":"NOOP"}'::jsonb, now()
      FROM generate_series(1, 400) g
    `);
    await db.execute(sql`ANALYZE draft_actions`);
    const query = db
      .select()
      .from(draftActions)
      .where(eq(draftActions.draftId, "df1"))
      .orderBy(asc(draftActions.sequence));
    expect(sequentiallyScannedRelations(await explainPlan(db, query))).not.toContain("draft_actions");
  });

  it("finds the teams that started a changed player by index, not by scanning lineups", async () => {
    const plan = await explainPlan(
      db,
      db
        .select({ teamId: lineupSlots.teamId })
        .from(lineupSlots)
        .where(and(eq(lineupSlots.weekNumber, 3), inArray(lineupSlots.playerId, ["p-1", "p-2", "p-3"]))),
    );
    expect(planUsesSeqScanOn(plan, "lineup_slots")).toBe(false);
  });

  it("finds the weeks a league never settled by index, not by scanning every matchup every tick", async () => {
    // `settleMissedWeeks` (`@/stats-pipeline/worker.ts`) runs this on EVERY tick — every thirty
    // minutes, forever, on the background pool — and neither of its predicates can use the primary
    // key, which leads with `league_id`. Unindexed, it is a sequential scan of every fixture in the
    // product; the partial index holds only the rows that are actually waiting to be settled.
    const query = db
      .selectDistinct({ leagueId: matchups.leagueId, week: matchups.weekNumber })
      .from(matchups)
      .where(and(inArray(matchups.weekNumber, [1, 2, 3, 4, 5]), isNull(matchups.homeScore)))
      .orderBy(asc(matchups.weekNumber), asc(matchups.leagueId))
      .limit(20);
    const plan = await explainPlan(db, query);

    expect(planUsesSeqScanOn(plan, "matchups")).toBe(false);
    // Pinned by name, like the chat page above: avoiding a Seq Scan is not enough on its own,
    // because a plain index on `(week_number, league_id)` would also avoid one while carrying every
    // settled row in the product. The partial index is what keeps this near-free forever.
    expect(indexScanNode(plan, "matchups_unsettled_idx")).toBeDefined();
  });

  /**
   * THE OPERATOR QUEUE'S OWN READ, and the cursor page under it — both EXPLAINed against
   * `pendingFlagQuery` itself (`@/integrity-service/flags`). Final review, LOW 11: `integrity_
   * flags` had a catalog assertion that its indexes EXIST and no assertion that anything USES
   * them, which is precisely why HIGH 4 was invisible to a green suite.
   */
  it("the operator queue's first page is a plain index scan, with no sort node above it", async () => {
    const plan = await explainPlan(db, pendingFlagQuery(db, {}));
    expect(sequentiallyScannedRelations(plan)).not.toContain("integrity_flags");
    const usedIndex = indexScanNode(plan, "integrity_flags_queue_idx");
    expect(usedIndex).toBeDefined();
    // The finding, pinned. With a one-column `(raised_at)` index the query's own
    // `ORDER BY raised_at, id` is only PARTLY served, so Postgres puts an `Incremental Sort`
    // above the scan — correct, and a cost that grows with the open queue on every page load.
    expect(nodeTypes(plan)).not.toContain("Incremental Sort");
    expect(nodeTypes(plan)).not.toContain("Sort");
  });

  it("the operator queue's cursor page seeks on the cursor, rather than filtering with it", async () => {
    const [oldest] = await db.execute<{ raised_at: string; id: string }>(
      sql`SELECT raised_at, id FROM integrity_flags WHERE resolved_at IS NULL ORDER BY raised_at, id OFFSET 500 LIMIT 1`,
    );
    const plan = await explainPlan(db, pendingFlagQuery(db, { before: { raisedAt: new Date(oldest!.raised_at).toISOString(), id: oldest!.id } }));
    const usedIndex = indexScanNode(plan, "integrity_flags_queue_idx");
    expect(usedIndex).toBeDefined();
    // The keyset cursor is a ROW COMPARISON on `(raised_at, id)`. Against a one-column index it
    // lands as `Filter: (ROW(raised_at, id) > ROW(...))` and every page re-walks from the oldest
    // OPEN flag and throws away what it already showed. Against `(raised_at, id)` it is an
    // `Index Cond` — the seek a keyset cursor exists to be. `Rows Removed by Filter` is NOT the
    // assertion: a Filter that happens to discard nothing on this page still re-walks the range.
    expect(usedIndex?.["Index Cond"]).toContain("ROW(raised_at, id) >");
    expect(usedIndex?.Filter).toBeUndefined();
  });

  /**
   * PHASE 3 PLAN D, TASK 11 — THE TASK 8 CARRY. `leagueModerationSummary`'s
   * (`@/integrity-service/flags`) third read — the open-question count a commissioner's own
   * moderation window shows — filters `integrity_flags` on `league_id = X AND resolved_at IS
   * NULL`. Neither column LEADS `integrity_flags_queue_idx` OR `integrity_flags_open_subject_idx`
   * — both are partial on the IDENTICAL predicate, `resolved_at IS NULL` — and MEASUREMENT, not
   * the docblock's own prediction, decides which one the planner actually reaches for: over this
   * corpus it is `integrity_flags_open_subject_idx`, chosen for its own cost reasons over the
   * queue index that named-reasoning assumed, which is why this asserts "some partial-on-open
   * index" rather than pinning either name — the property that matters is that `league_id` is
   * applied as a `Filter` over the BOUNDED open-flag population, never a scan of the platform's
   * whole flag history. The function itself awaits three inline reads with no exported query
   * builder, so this is the identical shape hand-built, the same "a simple single-table WHERE
   * reproduced by hand" pattern "a user's teams are found by index" above already uses.
   * `seedRealisticCorpus` spreads `league_id` one flag per league per `FLAG_COUNT`/`LEAGUE_COUNT`
   * cycle (Task 11 addition — every flag's `league_id` was `NULL` before this, which would have
   * proven nothing about a real league's own read) so this measures against a corpus where a real
   * league's flags are a real, bounded slice.
   *
   * FINAL REVIEW F9: this used to hand-rebuild the query. Five of the six assertions this branch
   * added imported the real builder and this one did not, so a filter added to production (F5's
   * own `flag_type` predicate, as it turned out) would have left this green while measuring a
   * query production no longer runs. `openQuestionsQuery` is now exported from `flags.ts` and
   * imported here, which is the fix this file already applies five times.
   */
  it("a commissioner's moderation window counts one league's open flags by index, never by scanning the flag table", async () => {
    const plan = await explainPlan(db, openQuestionsQuery(db, "lg7"));
    expect(sequentiallyScannedRelations(plan)).not.toContain("integrity_flags");
    const usedIndex = indexScanNode(plan, "integrity_flags_queue_idx") ?? indexScanNode(plan, "integrity_flags_open_subject_idx");
    expect(usedIndex).toBeDefined();
    // The heap scan carries the `Filter`, one level above the `Index Name` (`findNode`'s own
    // docblock): `league_id` is applied to the bounded set the partial index already narrowed to,
    // never to every row `integrity_flags` holds.
    const heapScan = findNode(plan, (node) => node["Relation Name"] === "integrity_flags");
    expect(heapScan?.Filter).toContain("league_id");
  });

  /**
   * `session_signals`' index, measured rather than assumed (final review, MEDIUM 10 and LOW 11).
   * The Sort here is UNAVOIDABLE and is not the failure: `signalsForUsers` orders globally across
   * every requested user, which no per-user index ordering can serve. What is asserted is the
   * only thing the index can deliver — the rows are FOUND by index rather than by scanning the
   * table — which is exactly why the index's second column was dead weight and is now gone.
   */
  it("a league's session signals are found by index, and the global ordering is sorted on top", async () => {
    const plan = await explainPlan(db, signalsForUsersQuery(db, ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9", "u10"]));
    expect(sequentiallyScannedRelations(plan)).not.toContain("session_signals");
    expect(indexScanNode(plan, "session_signals_user_occurred_idx")).toBeDefined();
  });

  it("finds the teams that OWN a changed player by index, for teams with no saved lineup", async () => {
    // The fallback half of the resolver: `getLineup` derives a legal lineup from the roster when
    // a manager never opened the editor, so a changed player can affect a team that has no
    // lineup_slots row at all. Both halves have to be index lookups or the "only affected
    // rosters" guarantee is only half true.
    const plan = await explainPlan(
      db,
      db.select({ teamId: rosterSlots.teamId }).from(rosterSlots).where(inArray(rosterSlots.playerId, ["p-1", "p-2", "p-3"])),
    );
    expect(planUsesSeqScanOn(plan, "roster_slots")).toBe(false);
  });

  /**
   * Phase 3 Plan C Task 4's own read: `materializeLockedLineupsInTx`
   * (`@/league-service/trade-transfer`) asks this exact question — teamId + weekNumber — once per
   * locked week, per team, before ever deriving a fallback lineup to freeze. Both columns lead
   * `lineup_slots`' own primary key, so this rides it rather than needing a new index.
   */
  it("checks whether a team already saved a lineup for one week by index, not by scanning every lineup row", async () => {
    const plan = await explainPlan(
      db,
      db
        .select({ teamId: lineupSlots.teamId })
        .from(lineupSlots)
        .where(and(eq(lineupSlots.teamId, "tm1_1"), eq(lineupSlots.weekNumber, 1)))
        .limit(1),
    );
    expect(planUsesSeqScanOn(plan, "lineup_slots")).toBe(false);
  });

  /**
   * Phase 3.6, Task 10, Step 1b (F1): `crossLeagueHome`'s own `lineupSet` read
   * (`@/league-service/home.ts`) — every caller's own team ids, no week filter, since one
   * caller's leagues can each be on a different current week. `team_id` still leads `lineup_
   * slots`' own primary key, so an `IN` over the caller's team ids rides it exactly the same way
   * the single-team lookup above does, rather than a new index.
   */
  it("answers a manager's own lineupSet fact across every league by index, not by scanning every lineup row", async () => {
    const plan = await explainPlan(
      db,
      db
        .selectDistinct({ teamId: lineupSlots.teamId, weekNumber: lineupSlots.weekNumber })
        .from(lineupSlots)
        .where(inArray(lineupSlots.teamId, ["tm1_1", "tm1_2", "tm1_3"])),
    );
    expect(planUsesSeqScanOn(plan, "lineup_slots")).toBe(false);
  });

  /**
   * `applyTradeInTx`'s own read: both teams' current rosters, fresh, inside the transaction that
   * is about to move a player between them — never trusted from propose time. `team_id` leads
   * `roster_slots`' own primary key, so an `IN` over two team ids is still an index lookup, not a
   * scan of every roster row in the product.
   */
  it("reads both trading teams' current rosters by index, not by scanning every roster row", async () => {
    const plan = await explainPlan(
      db,
      db
        .select({ teamId: rosterSlots.teamId, slot: rosterSlots.slot, slotIndex: rosterSlots.slotIndex, playerId: rosterSlots.playerId })
        .from(rosterSlots)
        .where(inArray(rosterSlots.teamId, ["tm1_1", "tm1_2"])),
    );
    expect(planUsesSeqScanOn(plan, "roster_slots")).toBe(false);
  });

  /**
   * PHASE 3.6, TASK 4 — THE FRONT DOOR'S OWN THREE READS. Unauthenticated, hit on every visit,
   * so each one is measured here rather than trusted to be cheap because the corpus is small.
   *
   * `leaguesFilledQuery` (`@/league-service/proof`) MEASURES AS TWO SEQUENTIAL SCANS, and this is
   * the correct plan, not a missing index: `DRAFTED_STATUSES` (`'in_progress'`/`'complete'`)
   * matches ~90% of this corpus's `drafts` (`DRAFT_SCHEDULED_INTERVAL`'s own docblock, `@/db/
   * test-corpus`), and the season window (`LEAGUE_CONFIG.season.startedAt`) matches EVERY league
   * `seedRealisticCorpus` seeds — every row created within the last `LEAGUE_COUNT` minutes, and
   * the season boundary in this deployment's single-season history is months wide. Neither
   * predicate is selective, so no index — existing or new — narrows either side of the join to
   * fewer rows than a sequential scan already reads; a bitmap index scan over ~90% of a table
   * costs strictly MORE than reading it in physical order, which is exactly what
   * `docs/decisions/data-layer-hardening.md`'s own cost-based reasoning already establishes for
   * `teams` above ("a user's teams are found by index" section intro). Measured at 5,008 leagues:
   * `Aggregate -> Hash Join -> (Seq Scan on leagues, Seq Scan on drafts)`, total cost ~749,
   * ~3.4ms wall time. THE REAL FINDING (for the report, not a silent pass): this query has no
   * index-shaped fix, because it counts most of two tables by design. What bounds its cost as
   * `leagues`/`drafts` grow over many seasons is not an index but a cache — see the task report.
   *
   * PHASE 4.5, TASK 2: `NOT is_mock` joined the `leagues` side's own `WHERE` (`leagues.created_at
   * >= season start AND leagues.is_mock = false`), and this corpus's own `seedRealisticCorpus`
   * never seeds a mock row — every league already reads `is_mock = false` by the column's own
   * default, the identical "matches every row" shape `season.startedAt` already has on this
   * corpus. MEASURED, not assumed: the plan shape is UNCHANGED (still two sequential scans, same
   * relations, same cost order), because a predicate that discards nothing changes nothing a
   * planner would ever seek an index for — this is the same reasoning the docblock above already
   * gives for the other two predicates, extended to the third.
   */
  it("measures the proof strip's leaguesFilled count — two genuinely unselective sequential scans, not a missing index", async () => {
    const plan = await explainPlan(db, leaguesFilledQuery(db));
    expect(nodeTypes(plan)).toContain("Aggregate");
    expect(nodeTypes(plan)).toContain("Hash Join");
    expect([...sequentiallyScannedRelations(plan)].sort()).toEqual(["drafts", "leagues"]);
    // The mutation proof, inverted from this file's usual shape: if EITHER side ever measures as
    // an index scan instead, this corpus's own selectivity assumption (stated above) has
    // silently stopped holding, and that is worth learning about explicitly.
    const filterNode = findNode(plan, (node) => node["Relation Name"] === "drafts");
    expect(filterNode?.Filter).toContain("status");
    // Phase 4.5, Task 2: the new predicate rides the SAME `leagues` scan, never a second one —
    // `is_mock` sits in that scan's own `Filter` alongside the season-window comparison.
    const leaguesFilterNode = findNode(plan, (node) => node["Relation Name"] === "leagues");
    expect(leaguesFilterNode?.Filter).toContain("is_mock");
  });

  /**
   * `roomsFillingQuery`/`tightestRoomQuery` (`@/league-service/proof`, storefront review R1) —
   * both wrap the SAME `fillingRoomsQuery` candidate set, so one EXPLAIN of one representative
   * (`roomsFillingQuery`) stands for both: identical inner plan, a different outer aggregate.
   * `ENFORCED_LEAGUE_SQL`'s `is_public_matchmade = true` still reaches `leagues` through
   * `leagues_public_browse_idx` — the SAME partial index `browseQuery`/`draftsNext48hQuery`
   * (this query's predecessor) already led every plan with, because the `WHERE` still matches
   * that index's partial predicate exactly. `status = 'scheduled'` no longer carries a
   * `kickoff_at` range beside it (this query has no time window at all — see its own docblock),
   * so `drafts_status_idx` serves the equality alone rather than the two-predicate seek
   * `dueDraftsQuery`'s assertion measures; `teams` joins through `teams_league_id_idx`, the one
   * relation neither `leaguesFilledQuery` nor the query this repoints ever touched.
   */
  it("the proof strip's roomsFillingNow/tightestRoom scan seeks on drafts_status_idx, leagues_public_browse_idx and teams_league_id_idx, never a sequential scan of any of the three", async () => {
    const plan = await explainPlan(db, roomsFillingQuery(db));
    expect(sequentiallyScannedRelations(plan)).toEqual([]);
    expect(indexScanNode(plan, "drafts_status_idx")).toBeDefined();
    expect(indexScanNode(plan, "leagues_public_browse_idx")).toBeDefined();
    expect(indexScanNode(plan, "teams_league_id_idx")).toBeDefined();
  });

  it("tightestRoomQuery rides the identical index seeks — one shared candidate set, a different outer aggregate", async () => {
    const plan = await explainPlan(db, tightestRoomQuery(db));
    expect(sequentiallyScannedRelations(plan)).toEqual([]);
    expect(indexScanNode(plan, "leagues_public_browse_idx")).toBeDefined();
  });

  /**
   * `reviewAggregateQuery` (`@/review-service/reviews`) MEASURES AS A SEQUENTIAL SCAN OF
   * `reviews`, and — the same reasoning as `leaguesFilledQuery` above — this is correct, not a
   * gap: `removed_at IS NULL` matches ~99% of this corpus (`REMOVED_REVIEW_INTERVAL` = 1 in 100,
   * the same "small realistic fraction of a rare state" ratio `test-corpus.ts`'s own
   * `OPEN_FLAG_INTERVAL` uses), so `reviews_feed_idx` — partial on that identical predicate —
   * would return nearly the whole table through a bitmap scan, strictly more expensive than
   * reading it sequentially. Measured at 5,000 reviews: `Aggregate -> Seq Scan on reviews
   * (Filter: removed_at IS NULL)`, cost ~182, ~0.7ms. Unlike the other two, this table's own
   * growth is naturally bounded — `reviews_user_idx` is UNIQUE per account, so its ceiling is the
   * platform's user count, never an unbounded per-visit or per-league table — which is why this
   * one is NOT flagged as a caching concern in the task report the way `leaguesFilledQuery` is.
   */
  it("measures the proof strip's rating aggregate — a genuinely unselective sequential scan of reviews, not a missing index", async () => {
    const plan = await explainPlan(db, reviewAggregateQuery(db));
    expect(nodeTypes(plan)).toContain("Aggregate");
    expect(sequentiallyScannedRelations(plan)).toEqual(["reviews"]);
    const scan = findNode(plan, (node) => node["Relation Name"] === "reviews");
    expect(scan?.Filter).toContain("removed_at");
  });

  /*
   * PHASE 4, TASK 2 — the money book's three indexes (migration 0035), each measured against the
   * query it exists to serve, over `seedMoneyCorpus`'s 12,000-entry book. The queries are built
   * inline for now, shaped exactly as their named consumers will issue them: Task 3's `read.ts`
   * (`walletSummary`'s statement read) and the Phase 5 guarantee (`getUserAnnualNetProfit`'s
   * tax-year read, founder decision 6), and Task 9/10's league money history. When those exported
   * builders land, these assertions should EXPLAIN the real export instead — the same evolution
   * every other query in this describe block already went through.
   */
  it("one account's statement is an index range scan of money_entries_account_created_idx, already in time order", async () => {
    const statement = db
      .select()
      .from(moneyEntries)
      .where(eq(moneyEntries.accountId, "user_available:mu7"))
      .orderBy(asc(moneyEntries.createdAt));
    const plan = await explainPlan(db, statement);
    expect(sequentiallyScannedRelations(plan)).not.toContain("money_entries");
    expect(indexScanNode(plan, "money_entries_account_created_idx")).toBeDefined();
    // `(account_id, created_at)` IS the ORDER BY under an equality on the leading column, so the
    // index hands back time order for free — the assertion that pins the second column's job.
    expect(nodeTypes(plan)).not.toContain("Sort");
  });

  it("the 1099 tax-year read seeks on money_entries_tax_year_state_idx instead of scanning the whole book each January", async () => {
    const taxYearTotal = db
      .select({ totalCents: sql<string>`sum(${moneyEntries.amountCents})` })
      .from(moneyEntries)
      .where(and(eq(moneyEntries.taxYear, 2026), eq(moneyEntries.stateOfEntry, "NJ")));
    const plan = await explainPlan(db, taxYearTotal);
    expect(sequentiallyScannedRelations(plan)).not.toContain("money_entries");
    expect(indexScanNode(plan, "money_entries_tax_year_state_idx")).toBeDefined();
  });

  it("a league's money history reads money_transactions_league_idx, never a sequential scan", async () => {
    const leagueHistory = db.select().from(moneyTransactions).where(eq(moneyTransactions.leagueId, "mlg7"));
    const plan = await explainPlan(db, leagueHistory);
    expect(sequentiallyScannedRelations(plan)).not.toContain("money_transactions");
    expect(indexScanNode(plan, "money_transactions_league_idx")).toBeDefined();
  });

  /**
   * MIGRATION 0038 — the wire-claims index, `seedWireClaimsAuditSample`'s own consumer. Built
   * inline, shaped exactly as `seatClaimsQuery` (`@/league-service/wire.ts`, design lane, `main`
   * only) issues it — this worktree cannot import that file, so the WHERE/JOIN shape is copied
   * here rather than trusted from memory (see `seedWireClaimsAuditSample`'s own docblock for the
   * full cross-lane account). `WIRE_WINDOW_MS`/`WIRE_MAX_ITEMS` mirror `MATCHMAKING_CONFIG.wire`
   * on `main` as of the merge this carry was found in (24 hours, 12 items) — literals, not an
   * import, for the same reason the query shape itself is copied rather than imported.
   *
   * THE MEASUREMENT, taken against migration 0037 (before this task's own migration existed):
   * over the 75,000-row corpus above, the planner could not seek on either existing composite —
   * `audit_events_league_occurred_idx` never sees a literal `league_id` to match its leading
   * column against, and `audit_events_actor_type_occurred_idx` never sees a literal `actor_id`
   * either — and fell back to a `Seq Scan` on `audit_events` (`Filter: event_type = 'member_
   * joined' AND occurred_at >= ... AND occurred_at <= ...`), discarding all but the ~80 rows in
   * the 24-hour window out of 75,000. `drizzle/0038_wire_claims_index.sql` adds a PARTIAL index
   * on `(occurred_at) WHERE event_type = 'member_joined'` — narrower than a full `(event_type,
   * occurred_at)` composite, and just as capable of seeking the range: `member_joined` is the
   * WHERE this read filters on, never a value it varies, so a partial predicate on it costs
   * nothing this read does not already commit to and keeps the index's own footprint
   * proportional to one event type out of `AUDIT_EVENT_TYPES`, not the whole table. The
   * assertions below are what the SAME plan measures now: no sequential scan of `audit_events`,
   * and the new index leading the seek.
   */
  it("the wire's seat-claims read seeks on audit_events_member_joined_occurred_idx, never a sequential scan of audit_events", async () => {
    const WIRE_WINDOW_MS = 24 * 60 * 60 * 1000;
    const WIRE_MAX_ITEMS = 12;
    const now = new Date();
    const windowStart = new Date(now.getTime() - WIRE_WINDOW_MS);
    // `payload->>'outcome' is distinct from 'seat_released'` — copied verbatim from wire.ts's own
    // `NOT_A_SEAT_RELEASE`, the predicate a release rides `member_joined` under instead of its
    // own event type (the audit compromise `releaseSeat`, `@/league-service/release`, makes).
    const NOT_A_SEAT_RELEASE = sql`${auditEvents.payload}->>'outcome' is distinct from 'seat_released'`;

    const seatClaims = db
      .select({
        leagueName: leagues.name,
        occurredAt: auditEvents.occurredAt,
        teamCount: leagues.teamCount,
        filledTeams: sql<number>`count(${teams.id})::int`,
      })
      .from(auditEvents)
      .innerJoin(leagues, eq(leagues.id, auditEvents.leagueId))
      .leftJoin(teams, eq(teams.leagueId, leagues.id))
      .where(
        and(
          eq(auditEvents.eventType, "member_joined"),
          NOT_A_SEAT_RELEASE,
          gte(auditEvents.occurredAt, windowStart),
          lte(auditEvents.occurredAt, now),
          ENFORCED_LEAGUE_SQL,
        ),
      )
      .groupBy(auditEvents.eventId, leagues.id)
      .orderBy(desc(auditEvents.occurredAt))
      .limit(WIRE_MAX_ITEMS);

    const plan = await explainPlan(db, seatClaims);
    expect(sequentiallyScannedRelations(plan)).not.toContain("audit_events");
    expect(indexScanNode(plan, "audit_events_member_joined_occurred_idx")).toBeDefined();

    // The mutation proof: the corpus's own arithmetic (`seedWireClaimsAuditSample`'s docblock)
    // guarantees a non-empty, non-trivial result — an assertion that could pass vacuously against
    // zero rows would prove nothing about which plan the planner actually chose.
    const rows = await seatClaims;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(WIRE_MAX_ITEMS);
  });
});

/**
 * The single source of truth for what every `trade_proposals` index is supposed to look like on
 * disk — read verbatim off `pg_indexes.indexdef` on a freshly migrated database, not hand-copied
 * a second time from the migration SQL or the schema. Two things read this SAME map: the
 * crash-safe healing `beforeAll` below (which restores any index that does not match before
 * anything is measured) and `trade_proposals carries exactly the indexes it declares` further
 * down (which asserts the catalog matches after every test in this file has had a chance to
 * mutate it). One map, so "correct" cannot drift between what heals and what verifies.
 */
const EXPECTED_TRADE_PROPOSALS_INDEXDEFS: Readonly<Record<string, string>> = {
  trade_proposals_open_fingerprint_idx:
    "CREATE UNIQUE INDEX trade_proposals_open_fingerprint_idx ON public.trade_proposals USING btree (fingerprint) WHERE (status = 'open'::text)",
  trade_proposals_inbox_idx:
    "CREATE INDEX trade_proposals_inbox_idx ON public.trade_proposals USING btree (counterparty_team_id, proposed_at) WHERE (status = 'open'::text)",
  trade_proposals_outbox_idx:
    "CREATE INDEX trade_proposals_outbox_idx ON public.trade_proposals USING btree (proposer_team_id, proposed_at) WHERE (status = 'open'::text)",
  trade_proposals_league_idx: "CREATE INDEX trade_proposals_league_idx ON public.trade_proposals USING btree (league_id, proposed_at)",
};

/**
 * Crash-safety for the mutation-proof test below, which tears `trade_proposals_inbox_idx` down
 * and rebuilds it by hand. That test's own `afterAll` covers a NORMAL finish (including an
 * assertion failure — `afterAll` still runs), but the shared `postgres-test` container survives
 * a hard crash between its `DROP INDEX` and that `afterAll` (an OOM kill, a `SIGKILL`, CI
 * cancellation), and nothing else in the pipeline repairs it: `drizzle-kit migrate`
 * (`db:migrate:test`) only applies migrations not yet recorded in `__drizzle_migrations`, and
 * hand DDL against an already-applied migration is invisible to it. Left broken, every later run
 * would silently measure the CORRUPTED index as its own baseline and the whole suite would pass
 * for the wrong reason — the exact gap `afterAll` alone cannot close.
 *
 * So: before anything in this file is measured, read every `trade_proposals` index's actual
 * definition back out of the catalog and restore any that does not match
 * `EXPECTED_TRADE_PROPOSALS_INDEXDEFS` — a corrupted database is corrected, never trusted.
 */
async function healTradeProposalsIndexes(): Promise<void> {
  const rows = await db.execute<{ indexname: string; indexdef: string }>(
    sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'trade_proposals'`,
  );
  const actual = new Map(rows.map((row) => [row.indexname, row.indexdef]));
  for (const [name, expected] of Object.entries(EXPECTED_TRADE_PROPOSALS_INDEXDEFS)) {
    if (actual.get(name) === expected) continue;
    await db.execute(sql`DROP INDEX IF EXISTS ${sql.identifier(name)}`);
    await db.execute(sql.raw(`${expected};`));
  }
}

/**
 * `trade_proposals`' own corpus — the carried item from Plan B's final review made mechanical
 * (ruling 24). Plan B's own gate tests were found to have measured queries production never
 * makes, over a corpus where every league held 2% of the table; this corpus is shaped the way a
 * real league actually produces rows instead — twelve teams, a season's worth of settled
 * history, and open proposals held UNDER the per-team cap (`TRADE_CONFIG.maxOpenProposalsPerTeam`
 * is 10) for every team, not a handful of leagues carrying the whole table between them.
 *
 * A separate corpus and a separate `beforeAll` from `seedRealisticCorpus` above, on purpose:
 * reusing the 5,000-league/3-teams-per-league shape above would either give every league too few
 * teams to hold a realistic trade history, or force every OTHER plan assertion in this file to
 * carry `trade_proposals` rows it has no use for. `truncateAll` in this block's own `beforeAll`
 * clears the corpus above before this one is written, and nothing after this block depends on
 * either. `seedTradeCorpus`'s own density contract is documented on it directly, in
 * `@/db/test-corpus`.
 */
describe("trade proposals: inbox and outbox serve from their own partial indexes, over a realistic corpus", () => {
  const CORPUS_LEAGUE = "tlg1";
  /** League 1's team 1. Every league's team `t` proposes to team `1 + (t % TEAMS_PER_LEAGUE)`,
   *  so team 1 is the one team in every league that receives from the LAST team rather than the
   *  one before it — team 1's inbox is exactly this league's `ttm1_12` offers, nothing more. */
  const CORPUS_TEAM = "ttm1_1";

  /** Set by the first test, read by the mutation-proof test — the same "measure once, compare
   *  later" shape the corpus's own docblock argues for: a regression is a claim about a DELTA,
   *  not an absolute number pulled out of the air. */
  let baselineInboxCost = 0;

  beforeAll(async () => {
    // Heals a crash-corrupted `trade_proposals_inbox_idx` FIRST, before anything is truncated,
    // seeded or measured — see `healTradeProposalsIndexes`'s own docblock for why `afterAll`
    // alone cannot be trusted to have run.
    await healTradeProposalsIndexes();
    await truncateAll(db);
    await seedTradeCorpus(db);
  }, 120_000);

  // The mutation-proof test below DROPs and recreates `trade_proposals_inbox_idx` without its
  // partial predicate — a real DDL change against the shared, long-lived test database, not
  // something `truncateAll` undoes. Left unrestored, every run after the first would measure
  // the BROKEN index as its own baseline and this whole block would pass for the wrong reason.
  afterAll(async () => {
    await db.execute(sql`DROP INDEX IF EXISTS trade_proposals_inbox_idx`);
    await db.execute(sql`CREATE INDEX trade_proposals_inbox_idx ON trade_proposals (counterparty_team_id, proposed_at) WHERE status = 'open'`);
  });

  it("serves the inbox from the partial index, over a corpus with real per-league density", async () => {
    const plan = await explainPlan(db, tradesQuery(db, { leagueId: CORPUS_LEAGUE, teamId: CORPUS_TEAM, box: "inbox" }));
    expect(sequentiallyScannedRelations(plan)).not.toContain("trade_proposals");
    expect(indexScanNode(plan, "trade_proposals_inbox_idx")).toBeDefined();
    baselineInboxCost = planCost(plan);
  });

  it("serves the outbox from its own partial index — same shape, other side", async () => {
    const plan = await explainPlan(db, tradesQuery(db, { leagueId: CORPUS_LEAGUE, teamId: CORPUS_TEAM, box: "outbox" }));
    expect(sequentiallyScannedRelations(plan)).not.toContain("trade_proposals");
    expect(indexScanNode(plan, "trade_proposals_outbox_idx")).toBeDefined();
  });

  /**
   * History's shape is genuinely different from inbox/outbox, not a reuse of the same path: it
   * has no `status = 'open'` predicate at all (history is `status = 'accepted'` OR the caller's
   * own row on either side — fix round 1, F1 — never every row in the league regardless of
   * status), so it cannot use either partial index and resolves through the non-partial
   * `trade_proposals_league_idx` instead — measured, at this corpus's 132-row-per-league density
   * (~0.5% of the 26,400-row table), as a Bitmap Index Scan on `league_id` feeding a `Sort` on
   * `proposed_at`. The `OR` added by F1 costs no second seek: the league is still found by ONE
   * seek on `league_id`, and `status = 'accepted' OR proposer_team_id = $1 OR
   * counterparty_team_id = $1` is applied as a `Filter` on the rows that seek already found. The
   * `Sort` is not a defect to chase away: the index's second key only pre-sorts a PLAIN Index
   * Scan, and at this per-league row count the planner's own cost model prefers the bitmap path
   * over walking the tree in order — the same tradeoff `signalsForUsers` above accepts for the
   * same reason. What is asserted is the property the index actually owns: the league is found by
   * seeking on `league_id`, never by scanning every row in the table.
   */
  it("serves history from the league index, filtered to accepted trades plus the caller's own dead ones", async () => {
    const plan = await explainPlan(db, tradesQuery(db, { leagueId: CORPUS_LEAGUE, teamId: CORPUS_TEAM, box: "history" }));
    expect(sequentiallyScannedRelations(plan)).not.toContain("trade_proposals");
    expect(indexScanNode(plan, "trade_proposals_league_idx")).toBeDefined();
  });

  /**
   * The mutation proof. A migration that recreated `trade_proposals_inbox_idx` without
   * `WHERE status = 'open'` would still BE an index, and at this corpus's per-team row counts
   * the planner can still choose it — so the assertion above only means something because this
   * one goes red when the predicate goes: the recreated index can no longer exclude a team's
   * settled history on its own, so the plan pays to read and then filter out rows the partial
   * predicate used to exclude for free, and the planner's own cost estimate rises to say so.
   */
  it("costs more than the baseline once the partial predicate is dropped from the inbox index", async () => {
    expect(baselineInboxCost).toBeGreaterThan(0);
    await db.execute(sql`DROP INDEX trade_proposals_inbox_idx`);
    await db.execute(sql`CREATE INDEX trade_proposals_inbox_idx ON trade_proposals (counterparty_team_id, proposed_at)`);
    await db.execute(sql`ANALYZE trade_proposals`);
    const plan = await explainPlan(db, tradesQuery(db, { leagueId: CORPUS_LEAGUE, teamId: CORPUS_TEAM, box: "inbox" }));
    expect(planCost(plan)).toBeGreaterThan(baselineInboxCost);
  });
});

/**
 * A STRUCTURAL guard, independent of `seedRealisticCorpus`/the planner. It used to assert the opposite of
 * what it asserts now, and the reversal is the finding.
 *
 * From 0018 through 0024 this index physically carried an INCLUDE list (`body`, later widened
 * with the two removal columns), which `schema.ts`'s `index()` builder has no API to express —
 * so the covering columns were real on disk and invisible to `drizzle-kit generate`'s diffing,
 * and this test existed to fail the build if a regenerated migration silently dropped them.
 * `drizzle/0026_measured_index_shapes.sql` dropped them ON PURPOSE, because the measurement said
 * they never did anything: `chatPageQuery` selects eleven more `chat_messages` columns than the
 * list carried and joins two tables, so no Index-Only Scan was ever reachable and the covering
 * columns bought 2.7x the index size for nothing (final review, HIGH 3).
 *
 * The guard is kept, inverted, for the same reason it was written: drizzle cannot see an INCLUDE
 * list, so it cannot see one being ADDED back either — by a hand-written migration, or by
 * somebody restoring 0024 from memory. The plan assertions above are what prove the index is
 * useful; this is what proves nobody quietly re-inflated it.
 */
describe("chat_messages_league_id_idx stays the slim two-column index the measurement justified", () => {
  it("carries the key and nothing else — no INCLUDE list, in either direction", async () => {
    const rows = await db.execute<{ indexname: string; indexdef: string }>(
      sql`SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'chat_messages_league_id_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/\(league_id, id\)/);
    expect(rows[0]!.indexdef).not.toContain("INCLUDE");
  });
});

/**
 * `audit_events`'s indexes and triggers, read back out of the catalog rather than trusted from
 * the SQL: the same reason `chat_messages_league_id_idx` is proven this way above. The triggers
 * in particular are hand-written (`drizzle/0019_audit_spine.sql`'s note) and invisible to
 * `drizzle-kit generate`'s diffing — a future migration that recreates this table and forgets
 * them fails HERE, in the build, rather than silently reopening the table to UPDATE and DELETE.
 */
describe("audit_events carries its indexes and its append-only triggers", () => {
  it("carries both composite indexes the scaling review named, plus the sequence backstop", async () => {
    const rows = await db.execute<{ indexname: string; indexdef: string }>(
      sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'audit_events'`,
    );
    const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));
    expect(byName.get("audit_events_scope_sequence_idx")).toMatch(/UNIQUE.*\(chain_scope, sequence\)/);
    expect(byName.get("audit_events_league_occurred_idx")).toMatch(/\(league_id, occurred_at\)/);
    expect(byName.get("audit_events_actor_type_occurred_idx")).toMatch(/\(actor_id, event_type, occurred_at\)/);
  });

  it("carries the append-only triggers, so a migration that recreates the table cannot drop them", async () => {
    const rows = await db.execute<{ tgname: string }>(sql`
      SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_events'::regclass AND NOT tgisinternal
    `);
    expect(rows.map((row) => row.tgname).sort()).toEqual(["audit_events_no_delete", "audit_events_no_update"]);
  });

  /**
   * `audit_chain_checkpoints`' own pair (`drizzle/0021_audit_checkpoint_append_only.sql`), pinned
   * the same way and for a sharper reason: this table is the THIRD account the verifier reconciles
   * against, and it is the only account that survives an adversary who deletes the tail of
   * `audit_events` and rewinds `audit_chains` to match. A migration that recreates the table and
   * forgets these triggers reopens that exact hole, silently.
   */
  it("carries the checkpoint table's forward-only triggers, which are what make it a detector", async () => {
    const rows = await db.execute<{ tgname: string }>(sql`
      SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_chain_checkpoints'::regclass AND NOT tgisinternal
    `);
    expect(rows.map((row) => row.tgname).sort()).toEqual(["audit_chain_checkpoints_forward_only", "audit_chain_checkpoints_no_delete"]);
  });
});

/**
 * Nothing else in this repo pins `audit_event_type`'s labels to `AUDIT_EVENT_TYPES`:
 * `drizzle-kit check` (which WOULD catch a schema.ts change with no matching migration) isn't
 * wired to any script here, and `pgEnum("audit_event_type", AUDIT_EVENT_TYPES)` in `schema.ts`
 * only constrains what a FUTURE `db:generate` would emit — it says nothing about what the
 * migration already applied to a real database actually created. A 17th entry added to
 * `AUDIT_EVENT_TYPES` without a matching migration reddens nothing without this test.
 */
describe("audit_event_type stays in sync with AUDIT_EVENT_TYPES", () => {
  it("carries exactly the domain vocabulary, in the same order", async () => {
    const rows = await db.execute<{ enumlabel: string }>(sql`
      SELECT enumlabel FROM pg_enum WHERE enumtypid = 'audit_event_type'::regtype ORDER BY enumsortorder
    `);
    expect(rows.map((row) => row.enumlabel)).toEqual([...AUDIT_EVENT_TYPES]);
  });
});

/**
 * Phase 4, Task 2 (migration 0035): the money book's guards, read back out of the catalog rather
 * than trusted from the SQL — the identical discipline `audit_events` gets above, and for the
 * book of record the sharpest version of the reason: the triggers and CHECKs are hand-written or
 * hand-named DDL that `drizzle-kit generate`'s diffing can silently drop on a table recreation,
 * and a money history that quietly reopened to UPDATE and DELETE would still pass every
 * service-layer test. `src/money-service/schema-invariants.test.ts` proves the guards FIRE; this
 * proves they are PRESENT, which is the half a migration regression actually breaks.
 */
describe("the money tables carry their append-only triggers, checks, indexes and enums", () => {
  it("carries the append-only trigger pair on money_entries AND money_transactions", async () => {
    const entryTriggers = await db.execute<{ tgname: string }>(sql`
      SELECT tgname FROM pg_trigger WHERE tgrelid = 'money_entries'::regclass AND NOT tgisinternal
    `);
    expect(entryTriggers.map((row) => row.tgname).sort()).toEqual(["money_entries_no_delete", "money_entries_no_update"]);
    const txnTriggers = await db.execute<{ tgname: string }>(sql`
      SELECT tgname FROM pg_trigger WHERE tgrelid = 'money_transactions'::regclass AND NOT tgisinternal
    `);
    expect(txnTriggers.map((row) => row.tgname).sort()).toEqual(["money_transactions_no_delete", "money_transactions_no_update"]);
  });

  it("carries ruling 5's balance floor and the positive-amount CHECK on disk", async () => {
    const accountChecks = await db.execute<{ conname: string; condef: string }>(sql`
      SELECT conname, pg_get_constraintdef(oid) AS condef
      FROM pg_constraint WHERE conrelid = 'money_accounts'::regclass AND contype = 'c'
    `);
    const floor = accountChecks.find((row) => row.conname === "money_accounts_balance_floor_ck");
    expect(floor?.condef).toContain("balance_cents >= 0");
    // The three kinds that may legitimately swing negative — the pool an ACH return reverses out
    // of, the clearing account mid-flight, and the receivable carrying the shortfall.
    expect(floor?.condef).toContain("fbo_pool");
    expect(floor?.condef).toContain("provider_clearing");
    expect(floor?.condef).toContain("platform_receivable");
    const entryChecks = await db.execute<{ conname: string; condef: string }>(sql`
      SELECT conname, pg_get_constraintdef(oid) AS condef
      FROM pg_constraint WHERE conrelid = 'money_entries'::regclass AND contype = 'c'
    `);
    expect(entryChecks.find((row) => row.conname === "money_entries_amount_positive_ck")?.condef).toContain("amount_cents > 0");
  });

  it("carries the three query indexes and the idempotency backstop", async () => {
    const rows = await db.execute<{ indexname: string; indexdef: string }>(
      sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('money_entries', 'money_transactions')`,
    );
    const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));
    expect(byName.get("money_entries_account_created_idx")).toMatch(/\(account_id, created_at\)/);
    expect(byName.get("money_entries_tax_year_state_idx")).toMatch(/\(tax_year, state_of_entry\)/);
    expect(byName.get("money_transactions_league_idx")).toMatch(/\(league_id\)/);
    expect(byName.get("money_transactions_idempotency_key_idx")).toMatch(/UNIQUE.*\(idempotency_key\)/);
  });

  it("keeps every money enum in step with its one vocabulary array, in the same order", async () => {
    const labelsOf = async (typeName: string): Promise<readonly string[]> => {
      const rows = await db.execute<{ enumlabel: string }>(sql`
        SELECT enumlabel FROM pg_enum WHERE enumtypid = ${typeName}::regtype ORDER BY enumsortorder
      `);
      return rows.map((row) => row.enumlabel);
    };
    expect(await labelsOf("money_account_kind")).toEqual([...MONEY_ACCOUNT_KINDS]);
    expect(await labelsOf("money_txn_kind")).toEqual([...MONEY_TXN_KINDS]);
    expect(await labelsOf("money_direction")).toEqual([...MONEY_DIRECTIONS]);
  });
});

/**
 * `integrity_flags`'s two indexes, read back out of the catalog rather than trusted from the
 * Drizzle definition — the same reason `audit_events`'s composite pair is proven this way above.
 * The partial predicate in particular is the property the whole table exists to make cheap: a
 * second report of an already-open subject must stay a fast lookup rather than a scan, and
 * `WHERE (resolved_at IS NULL)` on disk is what makes that true.
 */
describe("integrity_flags carries its open-subject and queue indexes", () => {
  it("carries the partial unique index and the partial queue index, both scoped to open flags", async () => {
    const rows = await db.execute<{ indexname: string; indexdef: string }>(
      sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'integrity_flags'`,
    );
    const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));
    expect(byName.get("integrity_flags_open_subject_idx")).toMatch(/UNIQUE.*\(subject_type, subject_id\)/);
    expect(byName.get("integrity_flags_open_subject_idx")).toContain("WHERE (resolved_at IS NULL)");
    // BOTH cursor keys (`drizzle/0026_measured_index_shapes.sql`). `(raised_at)` alone is only a
    // presorted prefix of `pendingFlagQuery`'s ordering, which is what put an Incremental Sort
    // over page one and turned the keyset cursor into a Filter — see the plan assertions above.
    expect(byName.get("integrity_flags_queue_idx")).toMatch(/\(raised_at, id\)/);
    expect(byName.get("integrity_flags_queue_idx")).toContain("WHERE (resolved_at IS NULL)");
  });
});

/**
 * `trade_proposals`'s four indexes, read back out of the catalog against
 * `EXPECTED_TRADE_PROPOSALS_INDEXDEFS` — the SAME source of truth `healTradeProposalsIndexes`
 * restores from. Runs LAST among this file's `describe` blocks (source order is execution
 * order here — `fileParallelism: false`), so it is also the closing half of the mutation-proof
 * test's own proof: that test's `afterAll` already put the inbox index back, and this is what
 * confirms the restoration actually landed correctly rather than merely running without
 * throwing. A migration that recreated any of these four without its exact predicate, or a
 * healing bug that "fixed" one into the wrong shape, reddens here even if every EXPLAIN
 * assertion above happened to still find an index scan by name.
 */
describe("trade_proposals carries exactly the indexes it declares", () => {
  it("matches EXPECTED_TRADE_PROPOSALS_INDEXDEFS on every index, byte for byte", async () => {
    const rows = await db.execute<{ indexname: string; indexdef: string }>(
      sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'trade_proposals' AND indexname != 'trade_proposals_pkey'`,
    );
    const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));
    expect([...byName.keys()].sort()).toEqual(Object.keys(EXPECTED_TRADE_PROPOSALS_INDEXDEFS).sort());
    for (const [name, expected] of Object.entries(EXPECTED_TRADE_PROPOSALS_INDEXDEFS)) {
      expect(byName.get(name)).toBe(expected);
    }
  });
});

/**
 * PHASE 3 PLAN D, TASK 1. The completed-season count (`completedSeasonsFor`,
 * `@/league-service/participation`) is the read the whole participation tier is built on — the
 * production builder itself, `completedSeasonsQuery`, EXPLAINed over the SAME realistic corpus
 * every "hot read paths" assertion above builds from. A separate `beforeAll` re-seeds it (the
 * trade corpus block above truncated and replaced it), rather than reordering `describe` blocks —
 * this file's execution order already carries meaning (`fileParallelism: false`, the trade block's
 * own closing catalog check runs deliberately last today), and reseeding is cheap next to
 * reasoning about a reordering that could silently break that.
 */
describe("the completed-season count uses an account's own team index, never a leagues scan", () => {
  beforeAll(async () => {
    await truncateAll(db);
    await seedRealisticCorpus(db);
  }, 120_000);

  it("serves the completed-season count from teams_user_id_idx, not a leagues scan", async () => {
    const plan = await explainPlan(db, completedSeasonsQuery(db, "u1"));
    expect(sequentiallyScannedRelations(plan)).not.toContain("leagues");
    expect(indexScanNode(plan, "teams_user_id_idx")).toBeDefined();
  });
});

/**
 * `leagues_season_completed_idx`'s own catalog proof (`drizzle/0028_season_completion.sql`) — the
 * SAME "read the definition back out of `pg_indexes`" discipline `chat_messages_league_id_idx`,
 * `integrity_flags` and `trade_proposals` all use above, chosen here over an EXPLAIN-based cost
 * mutation proof for a specific reason: no query in this task's own scope drives the planner to
 * CHOOSE this index over the primary key — a per-account completed-season count is a handful of
 * point lookups by `leagues.id` (proven above: `teams_user_id_idx` then a primary-key join, never
 * this index), which always wins a cost comparison against any secondary index. The risk this
 * partial index actually guards against is `drizzle-kit generate` silently dropping the clause
 * (Plan B ruling 17's `INCLUDE` trap turning a partial index into a full one nobody notices), not
 * the planner declining to use a clause it never needed — so the assertion that can actually
 * redden for the right reason is the catalog comparison, not a cost estimate that would never
 * move regardless of whether the predicate survived.
 *
 * THE MUTATION PROOF: drop and recreate the index WITHOUT its partial predicate, and the catalog
 * comparison reddens deterministically — the predicate is part of `indexdef`'s own text, not a
 * heuristic that might or might not move. An index test that cannot fail is a comment.
 *
 * CONTROLLER RULING, RESOLVED (Phase 3 Plan D, Task 2). Task 1's review flagged this index as
 * having no consumer anywhere in the plan and asked Task 2 to measure rather than assume. It
 * does have one, just not in Task 1's own scope: "DOES choose leagues_season_completed_idx" in
 * the "hot read paths use indexes" `describe` block above EXPLAINs `browseQuery`'s composition
 * join (`@/league-service/browse`) and finds an `Index Only Scan` on this exact index — the
 * `LEFT JOIN`'s `ON` clause carries `season_completed_at IS NOT NULL` alongside the id equality,
 * which matches this partial index's predicate exactly, unlike `completedSeasonsQuery`'s plain
 * `WHERE` below. No drop migration ships; this catalog proof stays as the mutation guard against
 * `drizzle-kit generate` silently widening the predicate, and the EXPLAIN proof above is the
 * cost-based confirmation that the index earns its keep.
 */
describe("leagues_season_completed_idx carries its partial predicate", () => {
  const EXPECTED_INDEXDEF = "CREATE INDEX leagues_season_completed_idx ON public.leagues USING btree (id) WHERE (season_completed_at IS NOT NULL)";

  async function indexDef(): Promise<string | undefined> {
    const rows = await db.execute<{ indexdef: string }>(sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'leagues_season_completed_idx'`);
    return rows[0]?.indexdef;
  }

  afterAll(async () => {
    // Restores the real index — a real DDL change against the shared, long-lived test database,
    // not something `truncateAll` undoes. Left broken, every later run would measure the
    // corrupted index as its own baseline, the same crash-safety discipline
    // `healTradeProposalsIndexes` exists for above.
    await db.execute(sql`DROP INDEX IF EXISTS leagues_season_completed_idx`);
    await db.execute(sql.raw(`${EXPECTED_INDEXDEF};`));
  });

  it("matches the migration's own definition, byte for byte", async () => {
    expect(await indexDef()).toBe(EXPECTED_INDEXDEF);
  });

  it("reddens when the partial predicate is dropped and the index is recreated without it", async () => {
    await db.execute(sql`DROP INDEX leagues_season_completed_idx`);
    await db.execute(sql`CREATE INDEX leagues_season_completed_idx ON leagues (id)`);
    expect(await indexDef()).not.toBe(EXPECTED_INDEXDEF);
  });
});

/**
 * PHASE 4.5, TASK 2 (evolved by TASK 6): `mock_rooms_starts_at_idx` (migration 0041), measured
 * against the REAL exported builder — Task 6's `dueMockRoomsQuery` (`@/mock-draft-service/
 * driver`) — exactly the evolution the Task 2 version of this block promised once the export
 * existed. The builder joins `drafts` on `status = 'scheduled'` (every corpus room below gets a
 * scheduled draft so the join is real), ranges on `starts_at <= now`, orders by the index's own
 * column first, and is LIMIT-bounded by `MOCK_CONFIG.maxMockStartsPerTick`.
 *
 * A dedicated corpus, sized like `seedHouseShelfSample`'s own small-sample-beside-the-big-corpus
 * shape rather than folded into `seedRealisticCorpus`: 2,000 mock rooms, half already due (`starts_
 * at` in the past) and half not, split by parity so neither half is a `LIMIT`-defeating
 * contiguous block. Every row is genuinely mock-room-shaped — its own league (`is_mock = true`),
 * its own host — because a partial index question ("does `starts_at` alone select few enough rows
 * to beat a sequential scan") is only answered honestly against realistic proportions.
 *
 * TASK 7 reuses this SAME corpus for `listOpenMockRoomsQuery` (`@/mock-draft-service/lobby`) —
 * every row here is already `lobby`-mode with a `scheduled` draft and zero seated teams, which is
 * exactly the lobby read's own candidate shape, so a second dedicated corpus would only pay the
 * same 2,000-row seed twice for no new signal.
 */
describe("mock_rooms_starts_at_idx serves the due-scan and sweep shape, never a sequential scan", () => {
  const MOCK_ROOM_COUNT = 2000;

  beforeAll(async () => {
    await truncateAll(db);
    await db.execute(sql`
      INSERT INTO users (id, email, display_name)
      SELECT 'mockidx_host_' || g, 'mockidx_host_' || g || '@test.local', 'Mock Host ' || g
      FROM generate_series(1, ${sql.raw(String(MOCK_ROOM_COUNT))}) g
    `);
    await db.execute(sql`
      INSERT INTO leagues (id, name, format, team_count, stake_tier, is_public_matchmade, experience_tier, commissioner_user_id, is_mock, created_at)
      SELECT 'mockidx_lg_' || g, 'Mock Room ' || g, 'snake'::draft_format, 12, 0, false, 'beginner'::experience_tier,
             'mockidx_host_' || g, true, now()
      FROM generate_series(1, ${sql.raw(String(MOCK_ROOM_COUNT))}) g
    `);
    // Half due (starts_at in the past), half not — split by parity, never a contiguous block,
    // so a `LIMIT`-bound scan cannot appear selective merely because the due rows happen to
    // cluster at one end of physical storage.
    await db.execute(sql`
      INSERT INTO mock_rooms (league_id, host_user_id, mode, pick_seconds, bot_seed, share_code, starts_at)
      SELECT 'mockidx_lg_' || g, 'mockidx_host_' || g, 'lobby'::mock_mode, 60, g, 'mockidx_code_' || g,
             CASE WHEN g % 2 = 0 THEN now() - (g || ' seconds')::interval ELSE now() + (g || ' seconds')::interval END
      FROM generate_series(1, ${sql.raw(String(MOCK_ROOM_COUNT))}) g
    `);
    // The scheduled draft every real mock room has (`createMockRoom` writes both in one
    // transaction) — without it the builder's join would run against an empty `drafts` and the
    // planner would be judged on a shape production never issues.
    await db.execute(sql`
      INSERT INTO drafts (id, league_id, format, status, kickoff_at)
      SELECT 'mockidx_dr_' || g, 'mockidx_lg_' || g, 'snake'::draft_format, 'scheduled'::draft_status, now()
      FROM generate_series(1, ${sql.raw(String(MOCK_ROOM_COUNT))}) g
    `);
    await db.execute(sql`ANALYZE users, leagues, mock_rooms, drafts`);
  }, 60_000);

  afterAll(async () => {
    await truncateAll(db);
  });

  it("seeks the REAL dueMockRoomsQuery on mock_rooms_starts_at_idx, never a sequential scan of mock_rooms", async () => {
    const plan = await explainPlan(db, dueMockRoomsQuery(db, new Date()));
    expect(sequentiallyScannedRelations(plan)).not.toContain("mock_rooms");
    expect(indexScanNode(plan, "mock_rooms_starts_at_idx")).toBeDefined();
  });

  /**
   * TASK 7: `listOpenMockRoomsQuery` has no index of its own to seek on `mock_rooms.mode` — this
   * table's small, retention-swept size (`MOCK_CONFIG.retention`) is what makes a sequential
   * scan of IT (or of this corpus's equally-sized `leagues` side, joined 1:1) an accepted,
   * planner-chosen shape rather than a missing index, the identical "genuinely unselective scan,
   * not a missing index" reasoning `leaguesFilledQuery`'s own EXPLAIN assertion documents for a
   * different pair of tables. This corpus deliberately sizes `mock_rooms` and its matching
   * `leagues` rows 1:1 (2,000 each) — the same skew the driving `mock_rooms` side would have in
   * production, where it never grows past the retention windows regardless of how large the
   * REAL `leagues` table gets, so a hash join over two equally-small sides here is not a
   * production risk. What is asserted is the shape every plan for this query must have
   * regardless of which join strategy the planner picks: a `Limit` over the `GROUP BY`/`HAVING`
   * aggregate, never an unbounded scan.
   */
  it("plans listOpenMockRoomsQuery as a bounded aggregate — a Limit over the seats-open HAVING, never unbounded", async () => {
    const plan = await explainPlan(db, listOpenMockRoomsQuery(db));
    expect(nodeTypes(plan)).toContain("Limit");
    expect(nodeTypes(plan).some((type) => type.includes("Aggregate"))).toBe(true);
  });

  it("returns exactly MOCK_CONFIG.maxLobbyListing rows against the 2,000-room corpus — every room here is an open lobby seat", async () => {
    const rows = await listOpenMockRoomsQuery(db);
    expect(rows).toHaveLength(MOCK_CONFIG.maxLobbyListing);
  });
});

