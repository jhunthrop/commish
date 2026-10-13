import { sql } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { invalidateAllTtlMemosForTests } from "@research-ts/lib/cache/ttl-memo";
import { resetRankedPlayersCacheForTests } from "@/draft-service/pool";

/**
 * THE LEAGUE APP'S TRUNCATIONS. The connection, the statement recorder and the error walk are the
 * research core's test support (`@research-ts/db/test-db`); what is here is the league app's: every
 * table of both halves, the money tables and the job tables, and the league caches a truncate must
 * drop with them (the prep site carve-out, 2026-10-12).
 */

/**
 * `nflverse_kicking_weeks` cascades from `nfl_players`, but naming it below is not redundant:
 * `nflverse_team_defense_weeks` beside it has NO foreign key at all (a team code is not an
 * `nfl_players.id`), so nothing cascades to it and a defense week written by one test outlived
 * every truncate until it was named. The pair is listed together so the two halves of the same
 * archive cannot drift apart again.
 */
/**
 * THE QUEUE JOINED THE LIST (peek document round, 2026-09-07). `jobs` has no foreign key into any
 * of the tables above it, so nothing cascaded it: a job enqueued by one test file outlived every
 * truncate and was still sitting there when the next file counted rows. It is named with its two
 * history tables and the schedule cursor, in child-before-parent order, so the append-only history
 * and the queue it belongs to cannot drift apart again. The append-only triggers do not block
 * TRUNCATE, by migration 0069's own note.
 */
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      audit_chain_checkpoints, audit_chains, audit_events, integrity_flags, session_signals,
      review_reports, reviews,
      chat_message_reports, chat_reactions, chat_messages,
      player_week_observations, player_week_teams, team_week_observations, player_prop_observations,
      props_player_map,
      preseason_rosters, preseason_rankings, preseason_projections, preseason_board_reasons, player_crosswalk,
      register_freeze_rows, register_grade_rows,
      nfl_draft_picks, nflverse_injuries, nflverse_roster_weeks,
      nflverse_kicking_weeks, nflverse_team_defense_weeks,
      draft_sheet_entries, draft_sheets,
      sim_runs, adp_snapshots, player_capsules, player_peek_facts, coaches, model_artifacts,
      nfl_players, player_stat_lines, players, stat_weeks, nfl_games, capture_snapshots,
      matchups, weeks, draft_grades, draft_picks, draft_nudges, draft_slot_preferences, draft_actions, drafts,
      lineup_slots, roster_slots, league_invites,
      scoring_settings, trade_proposals, teams, leagues, user_preferences, member_notices, users,
      job_run_steps, job_runs, jobs, schedule_cursors
    RESTART IDENTITY CASCADE
  `);
  // `rankedPlayers` (src/draft-service/pool.ts) memoizes per league id across calls — safe in
  // production (the player/stat-line universe is fixed), but a test suite reuses league ids
  // across `it` blocks under a fresh seed each time. Without this, a cache entry built before
  // this truncate would outlive the data it was computed from.
  resetRankedPlayersCacheForTests();
  // The reference memos (`createTtlMemo`) outlive a truncate for the identical reason.
  invalidateAllTtlMemosForTests();
}

/**
 * The money tables' own truncation (Phase 4, Task 2 — migration 0035), SEPARATE from
 * `truncateAll` for exactly one reason, and deliberately temporary: `src/db/pgbouncer.test.ts`
 * reaches Postgres through docker-compose's `pgbouncer-test`, whose config pins the ONE database
 * it routes (`commish_test`) — a database that stays at main's schema until this lane merges, so
 * a `truncateAll` that named the money tables would fail every pgbouncer test against a table
 * that does not exist there yet. Every money suite runs on the lane database (`TEST_DATABASE_URL`)
 * where 0035 IS applied, and calls this beside `truncateAll`. THE MERGE CLEANUP: once this lane
 * lands on main and `db:migrate:test` carries `commish_test` past 0035, fold these three names
 * into `truncateAll`'s own list and delete this helper.
 *
 * The append-only triggers do not block TRUNCATE, by 0035's own note (ruling 26's reasoning,
 * inherited from 0019/0021): table ownership can already DROP or DISABLE TRIGGER, and this
 * function is how every money integration test starts.
 *
 * `payment_transfer_intents` (Task 5, migration 0037) rides along for the same merge-cleanup
 * reason: it does not exist on main's `commish_test` until this lane lands.
 */
export async function truncateMoneyTables(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE money_entries, money_transactions, money_accounts, payment_transfer_intents RESTART IDENTITY CASCADE`,
  );
}

/**
 * The job system's own truncation (job-system round, migration 0068), SEPARATE from `truncateAll`
 * for the exact reason `truncateMoneyTables` was: these tables do not exist on main's
 * `commish_test` until this lane merges, and folding them into `truncateAll`'s list now would
 * fail every OTHER suite against a database that has not seen 0068 yet. Every job-system suite
 * calls this beside `truncateAll`. THE MERGE CLEANUP: once this lane lands and `db:migrate:test`
 * carries every lane past 0068, fold these four names into `truncateAll` and delete this helper.
 *
 * The append-only triggers on `job_runs`/`job_run_steps` do not block TRUNCATE, by 0019/0068's
 * own ruling (26): table ownership can already DROP or DISABLE TRIGGER, and this is how every
 * job-system integration test starts clean.
 */
export async function truncateJobTables(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE job_run_steps, job_runs, jobs, schedule_cursors RESTART IDENTITY CASCADE`);
}
