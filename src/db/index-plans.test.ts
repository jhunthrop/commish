import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asc, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "./test-db";
import { chatMessages, draftActions, teams } from "./schema";
import { explainPlan, sequentiallyScannedRelations } from "./explain";
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
  // Without ANALYZE the planner works from empty-table statistics and will choose a sequential
  // scan for everything, which would make this whole suite a false negative.
  await db.execute(sql`ANALYZE users, leagues, drafts, teams, chat_messages`);
}

describe("hot read paths use indexes", () => {
  beforeAll(async () => {
    await truncateAll(db);
    await seedCorpus();
  }, 120_000);

  // `teams` is deliberately not asserted here: at this corpus size, the planner's genuine
  // cost-based choice is a sequential scan of `teams` hashed once against ~500 matching
  // leagues, cheaper than ~1,500 individual index lookups even though `teams_league_id_idx`
  // exists and is exercised elsewhere (see "a user's teams are found by index" below, and the
  // narrowed browse test). See docs/decisions/data-layer-hardening.md for the
  // `enable_seqscan = off` diagnostic that confirmed the index path exists at all.
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
    expect(sequentiallyScannedRelations(await explainPlan(db, query))).not.toContain("chat_messages");
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
});
