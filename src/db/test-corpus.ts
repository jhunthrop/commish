import { sql } from "drizzle-orm";
import type { Db } from "./client";

/**
 * THE CORPUS-REALISM MECHANISM. Plan B's final review found two of its own gate tests measuring
 * queries production never makes, over a corpus at roughly 2% of a real league's density; Plan C
 * answered it per-assertion (ruling 24) and carried "a corpus-realism mechanism for plan
 * assertions" forward as a residual. This file is that mechanism: the two corpus builders that
 * used to be inlined in `src/db/index-plans.test.ts` — `seedRealisticCorpus` (the general-purpose
 * corpus every "hot read paths" EXPLAIN assertion builds from) and `seedTradeCorpus` (a SEPARATE,
 * twelve-teams-per-league corpus shaped like a real trade history rather than a toy one) — live
 * here, so every EXPLAIN assertion this plan adds builds from the SAME documented density
 * contract instead of a fresh, ad hoc one.
 *
 * THE DENSITY CONTRACT, restated once rather than re-derived per test file: `LEAGUE_COUNT` (5,000)
 * is big enough that Postgres has a genuine cost-based choice to make — a hundred-row table gets
 * sequentially scanned no matter what indexes exist, so a plan assertion against a toy dataset
 * asserts nothing. `TEAMS_PER_LEAGUE` (3) and `SEASON_WEEKS` (14, a full regular season) keep
 * `matchups` the largest table here, matching a real product's shape. Chat's `BUSY_CHAT_LEAGUES`
 * (40) hold a real conversation at roughly half a percent of the whole `chat_messages` table each
 * — the order of magnitude one league's own history occupies once the product has thousands of
 * leagues, never the ~2% a toy corpus would give it. `seedTradeCorpus`'s own density contract is
 * documented on that function directly: twelve teams per league (a real fantasy league's size,
 * not the general corpus's toy three), a full settled history behind every team, and open
 * proposals held UNDER `TRADE_CONFIG.maxOpenProposalsPerTeam` — a realistic fraction of the cap,
 * never a corpus sitting at the ceiling.
 *
 * EACH PLAN ASSERTION BUILT FROM THIS CORPUS IS PAIRED WITH A MUTATION PROOF where one exists:
 * drop the index (or its partial predicate), recreate it without the property under test, and
 * watch the assertion redden. An index test that cannot fail is a comment.
 */
export const LEAGUE_COUNT = 5_000;
export const TEAMS_PER_LEAGUE = 3;
export const USER_COUNT = 200;

/**
 * The full 15-slot roster and its 9-slot starting subset, inlined as raw-SQL `VALUES` lists
 * rather than imported from `@/domain/roster`: this file seeds through `db.execute(sql\`...\`)`,
 * not the domain layer, and the shape only needs to produce a realistic row count and column
 * spread, not stay wired to `STANDARD_ROSTER_SLOTS`.
 */
const LINEUP_STARTER_SLOTS = sql`(VALUES ('QB',0),('RB',0),('RB',1),('WR',0),('WR',1),('TE',0),('FLEX',0),('K',0),('DEF',0)) AS s(slot, idx)`;
const ROSTER_SLOTS = sql`(VALUES ('QB',0),('RB',0),('RB',1),('WR',0),('WR',1),('TE',0),('FLEX',0),('K',0),('DEF',0),('BENCH',0),('BENCH',1),('BENCH',2),('BENCH',3),('BENCH',4),('BENCH',5)) AS s(slot, idx)`;
export const LINEUP_WEEKS = 3;
/** A full regular season of fixtures per league, which is what makes `matchups` the largest table here. */
export const SEASON_WEEKS = 14;
/** One league in every this-many is left unsettled, so the partial index has a realistic slice to hold. */
export const UNSETTLED_LEAGUE_INTERVAL = 500;
/**
 * One league in every this-many has already completed its season (Phase 3 Plan D, Task 1) — a
 * 5% slice, selective enough that `leagues_season_completed_idx`'s partial predicate is worth
 * having and realistic once the platform has a season behind it, even though no league on this
 * platform has completed one at launch (`schema.ts`'s own note on `leagues.season_completed_at`).
 */
export const SEASON_COMPLETED_INTERVAL = 20;
/** Distinct synthetic player ids spread across the corpus, so `p-1`..`p-3` stay a small, selective slice. */
export const PLAYER_POOL_SIZE = 5_000;
/**
 * Chat's shape, and the numbers a chat-page plan assertion actually depends on. A few leagues
 * hold a real conversation (`lg1`..`lg40`, including the `lg7` every chat assertion below reads)
 * and everybody else holds a handful of messages. `lg7` therefore carries 200 of 40,000 rows —
 * half a percent, which is the order of magnitude one league's chat occupies in a product with
 * thousands of them, and the regime where seeking beats scanning the primary key backward. See
 * `seedRealisticCorpus`'s own note.
 */
export const BUSY_CHAT_LEAGUES = 40;
export const MESSAGES_PER_BUSY_LEAGUE = 200;
export const CHAT_TAIL_MESSAGES = 32_000;
/**
 * The operator queue's population. One flag in every `OPEN_FLAG_INTERVAL` is still open, which
 * is the ratio that makes `integrity_flags_queue_idx`'s partial predicate worth having: a
 * detector plus a report button produce flags forever, and an operator only ever reads the
 * handful nobody has answered yet.
 */
export const FLAG_COUNT = 60_000;
export const OPEN_FLAG_INTERVAL = 50;
/** Sign-ins on record. `signalsForUsers` reads one league's whole membership at once. */
export const SESSION_SIGNAL_COUNT = 100_000;

/**
 * The general-purpose corpus every "hot read paths" EXPLAIN assertion in `index-plans.test.ts`
 * builds from. See this file's own docblock for the density contract.
 */
export async function seedRealisticCorpus(db: Db): Promise<void> {
  await db.execute(sql`
    INSERT INTO users (id, email, display_name)
    SELECT 'u' || g, 'u' || g || '@example.test', 'Manager ' || g
    FROM generate_series(1, ${USER_COUNT}) g
  `);
  await db.execute(sql`
    INSERT INTO leagues (id, name, format, team_count, stake_tier, is_public_matchmade, experience_tier, commissioner_user_id, created_at, season_completed_at)
    SELECT 'lg' || g,
           'League ' || g,
           (ARRAY['snake','auction'])[1 + (g % 2)]::draft_format,
           12,
           g % 4,
           (g % 10 = 0),
           (ARRAY['beginner','experienced'])[1 + (g % 2)]::experience_tier,
           'u' || (1 + (g % ${USER_COUNT})),
           now() - (g || ' minutes')::interval,
           CASE WHEN g % ${SEASON_COMPLETED_INTERVAL} = 0 THEN now() - (g || ' days')::interval ELSE NULL END
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
  // Without ANALYZE the planner works from empty-table statistics and will choose a sequential
  // scan for everything, which would make this whole suite a false negative.
  await db.execute(sql`ANALYZE users, leagues, drafts, teams, roster_slots, lineup_slots, matchups, integrity_flags, session_signals`);
  // `chat_messages` is analyzed separately because it is seeded in two passes above and the
  // planner needs statistics that reflect both. No VACUUM is needed any more: the covering
  // INCLUDE list this used to exist for is gone (`drizzle/0026_measured_index_shapes.sql` —
  // the chat page joins two tables and reads eleven columns the index never carried, so an
  // Index-Only Scan was never reachable and the visibility map never mattered here).
  await db.execute(sql`ANALYZE chat_messages`);
}

/** `seedTradeCorpus`'s own team count — a real fantasy league's size, not the general corpus's
 *  toy three (`TEAMS_PER_LEAGUE`). */
export const TRADE_LEAGUE_COUNT = 200;
export const TRADE_TEAMS_PER_LEAGUE = 12;
/** Settled (TERMINAL) offers behind every team — the ratio that makes the partial index
 *  worth having: most of a team's history is not something the inbox/outbox ever reads again. */
export const SETTLED_PROPOSALS_PER_TEAM = 8;
/** Held under the cap, not at it — `TRADE_CONFIG.maxOpenProposalsPerTeam` is 10, and a corpus
 *  where every team sits at the ceiling would not be the shape a real league is usually in. */
export const OPEN_PROPOSALS_PER_TEAM = 3;

/**
 * `trade_proposals`' own corpus — the carried item from Plan B's final review made mechanical
 * (ruling 24). Plan B's own gate tests were found to have measured queries production never
 * makes, over a corpus where every league held 2% of the table; this corpus is shaped the way a
 * real league actually produces rows instead — twelve teams, a season's worth of settled
 * history, and open proposals held UNDER the per-team cap for every team, not a handful of
 * leagues carrying the whole table between them.
 *
 * A SEPARATE corpus from `seedRealisticCorpus`, on purpose: reusing the 5,000-league/3-teams-
 * per-league shape above would either give every league too few teams to hold a realistic trade
 * history, or force every OTHER plan assertion to carry `trade_proposals` rows it has no use for.
 * Callers truncate before seeding this corpus (`truncateAll`), and nothing after it depends on
 * either corpus surviving the other.
 */
export async function seedTradeCorpus(db: Db): Promise<void> {
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
