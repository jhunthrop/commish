import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { createTestDb, truncateAll } from "./test-db";
import { draftActions, lineupSlots, matchups, rosterSlots, teams } from "./schema";
import { explainPlan, findNode, indexScanNode, nodeTypes, planCost, planUsesSeqScanOn, sequentiallyScannedRelations } from "./explain";
import { seedRealisticCorpus, seedTradeCorpus } from "./test-corpus";
import { chatPageQuery } from "@/chat-service/chat";
import { dueDraftsQuery } from "@/draft-service/auto-start";
import { liveDraftsQuery } from "@/draft-service/ticker";
import { openQuestionsQuery, pendingFlagQuery } from "@/integrity-service/flags";
import { signalsForUsersQuery } from "@/integrity-service/session-signals";
import { completedSeasonsQuery } from "@/league-service/participation";
import { browseQuery, houseShelfQuery } from "@/league-service/browse";
import { leaguesNeedingAutoSetQuery } from "@/league-service/auto-lineup";
import { tradesQuery } from "@/league-service/trades";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { AUDIT_EVENT_TYPES } from "@/domain/audit";

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

describe("hot read paths use indexes", () => {
  beforeAll(async () => {
    await truncateAll(db);
    await seedRealisticCorpus(db);
    await seedHouseShelfSample(db);
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
   * the `LIMIT` ever applies. `kickoff_at` shipped as the index's second column, so this
   * assertion pins the FIXED shape: the composite `Index Cond` covers both predicates and nothing
   * is fetched only to be thrown away.
   */
  it("the auto-start due-kickoff scan seeks on (status, kickoff_at) together, discarding nothing", async () => {
    const plan = await explainPlan(db, dueDraftsQuery(db, new Date().toISOString()));
    expect(sequentiallyScannedRelations(plan)).not.toContain("drafts");
    const usedIndex = indexScanNode(plan, "drafts_status_idx");
    expect(usedIndex).toBeDefined();
    // Both predicates are ONE index condition, not a narrow-then-filter — the composite key
    // doing its job, not merely present in the plan by name.
    expect(usedIndex?.["Index Cond"]).toContain("status");
    expect(usedIndex?.["Index Cond"]).toContain("kickoff_at");
    // And the node that actually touches `drafts` heap pages (the Bitmap Heap Scan one level up
    // from the Bitmap Index Scan `indexScanNode` found) carries no `Filter` at all: every row the
    // index returned was one of the 45 genuinely due rows, none fetched only to be discarded.
    const draftsNode = findNode(plan, (node) => node["Relation Name"] === "drafts");
    expect(draftsNode).toBeDefined();
    expect(draftsNode?.Filter).toBeUndefined();
    expect(draftsNode?.["Rows Removed by Filter"] ?? 0).toBe(0);
  });

  /**
   * FINAL REVIEW F16 — THE SECOND READER, NOW ACTUALLY MEASURED. `src/db/schema.ts` opened the
   * `drafts_status_idx` comment with "TWO READERS, MEASURED" and
   * `docs/decisions/enforcement-and-tiers.md` §9 said the other reader "measures unchanged", but
   * only the due-kickoff scan above had an assertion behind it. Against this branch's own standard
   * that is an overclaim, and the cheaper of the two fixes is the honest one: measure it.
   *
   * `liveDraftsQuery` (`@/draft-service/ticker`) is the ticker's expiry scan, run on every tick.
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
