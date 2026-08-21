import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { createTestDb, truncateAll } from "./test-db";
import { draftActions, lineupSlots, matchups, rosterSlots, teams } from "./schema";
import { explainPlan, indexScanNode, nodeTypes, planCost, planUsesSeqScanOn, sequentiallyScannedRelations } from "./explain";
import { chatPageQuery } from "@/chat-service/chat";
import { pendingFlagQuery } from "@/integrity-service/flags";
import { signalsForUsersQuery } from "@/integrity-service/session-signals";
import { browseQuery } from "@/league-service/browse";
import { tradesQuery } from "@/league-service/trades";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { AUDIT_EVENT_TYPES } from "@/domain/audit";

const db = createTestDb();

/**
 * Big enough that the planner has a real choice. Postgres will happily sequential-scan a
 * hundred-row table no matter what indexes exist, so a plan assertion against a toy dataset
 * asserts nothing at all. 5,000 leagues with 10% public and three teams each is roughly the
 * shape of a product with a few thousand leagues, which is where these paths start to matter.
 */
const LEAGUE_COUNT = 5_000;
const TEAMS_PER_LEAGUE = 3;
const USER_COUNT = 200;

/**
 * The full 15-slot roster and its 9-slot starting subset, inlined as raw-SQL `VALUES` lists
 * rather than imported from `@/domain/roster`: this file seeds through `db.execute(sql\`...\`)`,
 * not the domain layer, and the shape only needs to produce a realistic row count and column
 * spread, not stay wired to `STANDARD_ROSTER_SLOTS`.
 */
const LINEUP_STARTER_SLOTS = sql`(VALUES ('QB',0),('RB',0),('RB',1),('WR',0),('WR',1),('TE',0),('FLEX',0),('K',0),('DEF',0)) AS s(slot, idx)`;
const ROSTER_SLOTS = sql`(VALUES ('QB',0),('RB',0),('RB',1),('WR',0),('WR',1),('TE',0),('FLEX',0),('K',0),('DEF',0),('BENCH',0),('BENCH',1),('BENCH',2),('BENCH',3),('BENCH',4),('BENCH',5)) AS s(slot, idx)`;
const LINEUP_WEEKS = 3;
/** A full regular season of fixtures per league, which is what makes `matchups` the largest table here. */
const SEASON_WEEKS = 14;
/** One league in every this-many is left unsettled, so the partial index has a realistic slice to hold. */
const UNSETTLED_LEAGUE_INTERVAL = 500;
/** Distinct synthetic player ids spread across the corpus, so `p-1`..`p-3` stay a small, selective slice. */
const PLAYER_POOL_SIZE = 5_000;
/**
 * Chat's shape, and the numbers a chat-page plan assertion actually depends on. A few leagues
 * hold a real conversation (`lg1`..`lg40`, including the `lg7` every chat assertion below reads)
 * and everybody else holds a handful of messages. `lg7` therefore carries 200 of 40,000 rows —
 * half a percent, which is the order of magnitude one league's chat occupies in a product with
 * thousands of them, and the regime where seeking beats scanning the primary key backward. See
 * `seedCorpus`'s own note.
 */
const BUSY_CHAT_LEAGUES = 40;
const MESSAGES_PER_BUSY_LEAGUE = 200;
const CHAT_TAIL_MESSAGES = 32_000;
/**
 * The operator queue's population. One flag in every `OPEN_FLAG_INTERVAL` is still open, which
 * is the ratio that makes `integrity_flags_queue_idx`'s partial predicate worth having: a
 * detector plus a report button produce flags forever, and an operator only ever reads the
 * handful nobody has answered yet.
 */
const FLAG_COUNT = 60_000;
const OPEN_FLAG_INTERVAL = 50;
/** Sign-ins on record. `signalsForUsers` reads one league's whole membership at once. */
const SESSION_SIGNAL_COUNT = 100_000;

async function seedCorpus(): Promise<void> {
  await db.execute(sql`
    INSERT INTO users (id, email, display_name)
    SELECT 'u' || g, 'u' || g || '@example.test', 'Manager ' || g
    FROM generate_series(1, ${USER_COUNT}) g
  `);
  await db.execute(sql`
    INSERT INTO leagues (id, name, format, team_count, stake_tier, is_public_matchmade, experience_tier, commissioner_user_id, created_at)
    SELECT 'lg' || g,
           'League ' || g,
           (ARRAY['snake','auction'])[1 + (g % 2)]::draft_format,
           12,
           g % 4,
           (g % 10 = 0),
           (ARRAY['beginner','experienced'])[1 + (g % 2)]::experience_tier,
           'u' || (1 + (g % ${USER_COUNT})),
           now() - (g || ' minutes')::interval
    FROM generate_series(1, ${LEAGUE_COUNT}) g
  `);
  await db.execute(sql`
    INSERT INTO drafts (id, league_id, format, status, kickoff_at)
    SELECT 'df' || g, 'lg' || g,
           (ARRAY['snake','auction'])[1 + (g % 2)]::draft_format,
           'scheduled'::draft_status,
           now() + interval '1 day'
    FROM generate_series(1, ${LEAGUE_COUNT}) g
  `);
  await db.execute(sql`
    INSERT INTO teams (id, league_id, user_id, name)
    SELECT 'tm' || g || '_' || t, 'lg' || g, 'u' || (1 + ((g * 7 + t) % ${USER_COUNT})), 'Team ' || t
    FROM generate_series(1, ${LEAGUE_COUNT}) g, generate_series(1, ${TEAMS_PER_LEAGUE}) t
  `);
  // Chat's league spread is the whole point of this corpus, not an incidental detail. The
  // earlier version put all 20,000 messages into 50 leagues, which gave every league 2% of the
  // table — a slice big enough that a backward primary-key scan really is the planner's best
  // plan, and small enough to look realistic. It is not: in a product with thousands of leagues
  // one league's conversation is a fraction of a percent of all chat, which is exactly when a
  // `(league_id, id)` seek stops being optional. So the seed is shaped like the real thing —
  // a handful of busy leagues carrying real conversations, and a long tail of everybody else.
  await db.execute(sql`
    INSERT INTO chat_messages (league_id, author_user_id, body)
    SELECT 'lg' || l, 'u' || (1 + ((l * 13 + g) % ${USER_COUNT})), 'message ' || g
    FROM generate_series(1, ${BUSY_CHAT_LEAGUES}) l, generate_series(1, ${MESSAGES_PER_BUSY_LEAGUE}) g
  `);
  await db.execute(sql`
    INSERT INTO chat_messages (league_id, author_user_id, body)
    SELECT 'lg' || (${BUSY_CHAT_LEAGUES} + 1 + (g % ${LEAGUE_COUNT - 40})), 'u' || (1 + (g % ${USER_COUNT})), 'tail ' || g
    FROM generate_series(1, ${CHAT_TAIL_MESSAGES}) g
  `);
  // Every team's full roster — every drafted team has one, so this is the whole population, not
  // a slice of it. 5,000 leagues x 3 teams x 15 slots = 225,000 rows, comfortably past the
  // 50,000-row floor a real planner choice needs.
  await db.execute(sql`
    INSERT INTO roster_slots (team_id, slot, slot_index, player_id)
    SELECT 'tm' || g || '_' || t, s.slot, s.idx,
           'p-' || (1 + ((g * 17 + t * 11 + s.idx * 5) % ${PLAYER_POOL_SIZE}))
    FROM generate_series(1, ${LEAGUE_COUNT}) g, generate_series(1, ${TEAMS_PER_LEAGUE}) t, ${ROSTER_SLOTS}
  `);
  // A genuine subset, not the whole population: `lineup_slots`'s own docstring says an absent row
  // is normal, since `defaultLineup()` derives a legal lineup from the roster for anyone who never
  // opened the editor. One team per league across 3 weeks of starters: 5,000 x 3 x 9 = 135,000
  // rows, again well past the floor, while leaving most teams with no lineup row for most weeks —
  // which is exactly the shape "finds the teams that OWN a changed player" below exists to cover.
  await db.execute(sql`
    INSERT INTO lineup_slots (team_id, week_number, slot, slot_index, player_id)
    SELECT 'tm' || g || '_1', w, s.slot, s.idx,
           'p-' || (1 + ((g * 31 + w * 13 + s.idx * 7) % ${PLAYER_POOL_SIZE}))
    FROM generate_series(1, ${LEAGUE_COUNT}) g, generate_series(1, ${LINEUP_WEEKS}) w, ${LINEUP_STARTER_SLOTS}
  `);
  // A full season of fixtures for every league: 5,000 x 14 = 70,000 rows, nearly all of them
  // SETTLED. That ratio is the point — the ingestion worker's late-settlement query looks for the
  // handful that are not, every thirty minutes, and a partial index is only worth having if the
  // corpus reflects how rare its rows are.
  await db.execute(sql`
    INSERT INTO matchups (league_id, week_number, home_team_id, away_team_id, home_score, away_score)
    SELECT 'lg' || g, w, 'tm' || g || '_1', 'tm' || g || '_2',
           CASE WHEN g % ${UNSETTLED_LEAGUE_INTERVAL} = 0 THEN NULL ELSE 100 + (g % 40) END,
           CASE WHEN g % ${UNSETTLED_LEAGUE_INTERVAL} = 0 THEN NULL ELSE 90 + (g % 35) END
    FROM generate_series(1, ${LEAGUE_COUNT}) g, generate_series(1, ${SEASON_WEEKS}) w
  `);
  // Without ANALYZE the planner works from empty-table statistics and will choose a sequential
  // scan for everything, which would make this whole suite a false negative.
  // The operator queue's own corpus. Mostly RESOLVED, because that ratio is the whole reason the
  // queue index is partial: an operator's page one must stay proportional to what is still open,
  // not to every flag the platform ever raised.
  await db.execute(sql`
    INSERT INTO integrity_flags (id, flag_type, subject_type, subject_id, evidence, raised_at, resolved_at)
    SELECT 'flg' || g, 'chat_report', 'chat_message', 'msg' || g, '{}'::jsonb,
           now() - (g || ' seconds')::interval,
           CASE WHEN g % ${OPEN_FLAG_INTERVAL} = 0 THEN NULL ELSE now() END
    FROM generate_series(1, ${FLAG_COUNT}) g
  `);
  // Session signals, many per account: `signalsForUsers` reads every row for every member of one
  // league at once, so the population that matters is "one account's whole sign-in history",
  // repeated across the user base.
  await db.execute(sql`
    INSERT INTO session_signals (id, user_id, occurred_at, user_agent, accept_language, ip_source)
    SELECT 'sig' || g, 'u' || (1 + (g % ${USER_COUNT})), now() - (g || ' seconds')::interval,
           'UA/' || (g % 7), 'en-US', 'xff_unverified'
    FROM generate_series(1, ${SESSION_SIGNAL_COUNT}) g
  `);
  await db.execute(sql`ANALYZE users, leagues, drafts, teams, roster_slots, lineup_slots, matchups, integrity_flags, session_signals`);
  // `chat_messages` is analyzed separately because it is seeded in two passes above and the
  // planner needs statistics that reflect both. No VACUUM is needed any more: the covering
  // INCLUDE list this used to exist for is gone (`drizzle/0026_measured_index_shapes.sql` —
  // the chat page joins two tables and reads eleven columns the index never carried, so an
  // Index-Only Scan was never reachable and the visibility map never mattered here).
  await db.execute(sql`ANALYZE chat_messages`);
}

describe("hot read paths use indexes", () => {
  beforeAll(async () => {
    await truncateAll(db);
    await seedCorpus();
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
      browseQuery(db, { format: "auction", experienceTier: "experienced", stakeTier: 3 }),
    );
    expect(sequentiallyScannedRelations(plan)).not.toContain("leagues");
  });

  it("a user's teams are found by index, not by scanning every team", async () => {
    const query = db.select({ leagueId: teams.leagueId, teamId: teams.id }).from(teams).where(eq(teams.userId, "u7"));
    expect(sequentiallyScannedRelations(await explainPlan(db, query))).not.toContain("teams");
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
 * A separate corpus and a separate `beforeAll` from `seedCorpus` above, on purpose: reusing the
 * 5,000-league/3-teams-per-league shape above would either give every league too few teams to
 * hold a realistic trade history, or force every OTHER plan assertion in this file to carry
 * `trade_proposals` rows it has no use for. `truncateAll` in this block's own `beforeAll` clears
 * the corpus above before this one is written, and nothing after this block depends on either.
 */
describe("trade proposals: inbox and outbox serve from their own partial indexes, over a realistic corpus", () => {
  const TRADE_LEAGUE_COUNT = 200;
  const TRADE_TEAMS_PER_LEAGUE = 12;
  /** Settled (TERMINAL) offers behind every team — the ratio that makes the partial index
   *  worth having: most of a team's history is not something the inbox/outbox ever reads again. */
  const SETTLED_PROPOSALS_PER_TEAM = 8;
  /** Held under the cap, not at it — `TRADE_CONFIG.maxOpenProposalsPerTeam` is 10, and a corpus
   *  where every team sits at the ceiling would not be the shape a real league is usually in. */
  const OPEN_PROPOSALS_PER_TEAM = 3;
  const CORPUS_LEAGUE = "tlg1";
  /** League 1's team 1. Every league's team `t` proposes to team `1 + (t % TEAMS_PER_LEAGUE)`,
   *  so team 1 is the one team in every league that receives from the LAST team rather than the
   *  one before it — team 1's inbox is exactly this league's `ttm1_12` offers, nothing more. */
  const CORPUS_TEAM = "ttm1_1";

  async function seedTradeCorpus(): Promise<void> {
    await db.execute(sql`
      INSERT INTO users (id, email, display_name)
      SELECT 'tu' || g, 'tu' || g || '@example.test', 'Trade Manager ' || g
      FROM generate_series(1, ${TRADE_LEAGUE_COUNT * TRADE_TEAMS_PER_LEAGUE}) g
    `);
    await db.execute(sql`
      INSERT INTO leagues (id, name, format, team_count, commissioner_user_id)
      SELECT 'tlg' || g, 'Trade League ' || g, 'snake'::draft_format, ${TRADE_TEAMS_PER_LEAGUE},
             'tu' || (((g - 1) * ${TRADE_TEAMS_PER_LEAGUE}) + 1)
      FROM generate_series(1, ${TRADE_LEAGUE_COUNT}) g
    `);
    await db.execute(sql`
      INSERT INTO teams (id, league_id, user_id, name)
      SELECT 'ttm' || g || '_' || t, 'tlg' || g, 'tu' || (((g - 1) * ${TRADE_TEAMS_PER_LEAGUE}) + t), 'Team ' || t
      FROM generate_series(1, ${TRADE_LEAGUE_COUNT}) g, generate_series(1, ${TRADE_TEAMS_PER_LEAGUE}) t
    `);
    await db.execute(sql`
      INSERT INTO trade_proposals
        (id, league_id, proposer_team_id, counterparty_team_id, week_number,
         proposer_assets, counterparty_assets, fingerprint, status, proposed_at, expires_at, settled_at)
      SELECT
        'tpr_s_' || g || '_' || t || '_' || n,
        'tlg' || g,
        'ttm' || g || '_' || t,
        'ttm' || g || '_' || (1 + (t % ${TRADE_TEAMS_PER_LEAGUE})),
        1,
        jsonb_build_array(jsonb_build_object('kind', 'player', 'playerId', 'p-' || g || '-' || t || '-' || n || '-a')),
        jsonb_build_array(jsonb_build_object('kind', 'player', 'playerId', 'p-' || g || '-' || t || '-' || n || '-b')),
        md5('settled-' || g || '-' || t || '-' || n),
        'rejected',
        now() - (n || ' days')::interval,
        now() + interval '3 days',
        now() - (n || ' days')::interval + interval '1 hour'
      FROM generate_series(1, ${TRADE_LEAGUE_COUNT}) g, generate_series(1, ${TRADE_TEAMS_PER_LEAGUE}) t,
           generate_series(1, ${SETTLED_PROPOSALS_PER_TEAM}) n
    `);
    await db.execute(sql`
      INSERT INTO trade_proposals
        (id, league_id, proposer_team_id, counterparty_team_id, week_number,
         proposer_assets, counterparty_assets, fingerprint, status, proposed_at, expires_at)
      SELECT
        'tpr_o_' || g || '_' || t || '_' || n,
        'tlg' || g,
        'ttm' || g || '_' || t,
        'ttm' || g || '_' || (1 + (t % ${TRADE_TEAMS_PER_LEAGUE})),
        1,
        jsonb_build_array(jsonb_build_object('kind', 'player', 'playerId', 'p-open-' || g || '-' || t || '-' || n || '-a')),
        jsonb_build_array(jsonb_build_object('kind', 'player', 'playerId', 'p-open-' || g || '-' || t || '-' || n || '-b')),
        md5('open-' || g || '-' || t || '-' || n),
        'open',
        now() - (n || ' hours')::interval,
        now() + interval '3 days'
      FROM generate_series(1, ${TRADE_LEAGUE_COUNT}) g, generate_series(1, ${TRADE_TEAMS_PER_LEAGUE}) t,
           generate_series(1, ${OPEN_PROPOSALS_PER_TEAM}) n
    `);
    await db.execute(sql`ANALYZE users, leagues, teams`);
    await db.execute(sql`VACUUM ANALYZE trade_proposals`);
  }

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
    await seedTradeCorpus();
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
   * has no `status = 'open'` predicate at all (history is a league's WHOLE settled record, not
   * its open queue), so it cannot use either partial index and resolves through the non-partial
   * `trade_proposals_league_idx` instead — measured, at this corpus's 132-row-per-league density
   * (~0.5% of the 26,400-row table), as a Bitmap Index Scan on `league_id` feeding a `Sort` on
   * `proposed_at`. The `Sort` is not a defect to chase away: the index's second key only
   * pre-sorts a PLAIN Index Scan, and at this per-league row count the planner's own cost model
   * prefers the bitmap path over walking the tree in order — the same tradeoff `signalsForUsers`
   * above accepts for the same reason. What is asserted is the property the index actually owns:
   * the league is found by seeking on `league_id`, never by scanning every row in the table.
   */
  it("serves history from the league index — not partial, because history is the settled record", async () => {
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
 * A STRUCTURAL guard, independent of `seedCorpus`/the planner. It used to assert the opposite of
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
