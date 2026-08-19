import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { and, asc, eq, inArray } from "drizzle-orm";
import { createTestDb, truncateAll } from "./test-db";
import { chatMessages, draftActions, lineupSlots, rosterSlots, teams } from "./schema";
import { explainPlan, indexScanNode, planUsesSeqScanOn, sequentiallyScannedRelations } from "./explain";
import { browseQuery } from "@/league-service/browse";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";

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
/** Distinct synthetic player ids spread across the corpus, so `p-1`..`p-3` stay a small, selective slice. */
const PLAYER_POOL_SIZE = 5_000;

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
  await db.execute(sql`
    INSERT INTO chat_messages (league_id, author_user_id, body)
    SELECT 'lg' || (1 + (g % 50)), 'u' || (1 + (g % ${USER_COUNT})), 'message ' || g
    FROM generate_series(1, 20000) g
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
  // Without ANALYZE the planner works from empty-table statistics and will choose a sequential
  // scan for everything, which would make this whole suite a false negative.
  await db.execute(sql`ANALYZE users, leagues, drafts, teams, chat_messages, roster_slots, lineup_slots`);
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

  it("a chat page is an index range scan, not a scan of the whole league's history", async () => {
    const query = db
      .select({ id: chatMessages.id, body: chatMessages.body })
      .from(chatMessages)
      .where(eq(chatMessages.leagueId, "lg7"))
      .orderBy(asc(chatMessages.id))
      .limit(50);
    const plan = await explainPlan(db, query);
    expect(sequentiallyScannedRelations(plan)).not.toContain("chat_messages");
    // Not enough on its own: dropping `chat_messages_league_id_idx` still avoids a Seq Scan by
    // falling back to an Index Scan on the primary key, filtering out every other league's rows
    // rather than seeking straight to this one's range — a ratio that grows with total chat
    // volume. Pin the index by name, and confirm nothing was discarded by a Filter clause (the
    // signature of exactly that pkey-scan-and-discard fallback).
    const usedIndex = indexScanNode(plan, "chat_messages_league_id_idx");
    expect(usedIndex).toBeDefined();
    expect(usedIndex?.["Rows Removed by Filter"] ?? 0).toBe(0);
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
});
