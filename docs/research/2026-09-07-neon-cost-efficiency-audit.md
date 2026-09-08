# Neon cost efficiency audit

Date: 2026-09-07. Scope: every database call path in Commish as deployed on Vercel (project `commish`, team `teamcommish`, region iad1, Fluid Compute on) against Neon serverless Postgres. Read-only audit. No application code was changed.

Basis labels used throughout: **measured on dev** (statement log of the local Docker Postgres 17.11 while a harness called the real loader functions), **counted from code** (statements traced by reading the source), **read from logs** (Vercel runtime logs for the production deployment `commish-j7xzprojk`, a 25 minute window ending 2026-09-08 00:25 UTC, fetched with `vercel logs --json`), **read from project settings** (`vercel api /v9/projects/...` and `vercel env ls`), **fetched today** (a vendor pricing page fetched on 2026-09-07 with the URL cited), and **estimated** (arithmetic on the above with the assumption stated).

## Summary

The database is never allowed to sleep, and almost nothing a user does is the reason. The Vercel cron calls `/api/jobs/tick` every minute, and each tick runs about 40 statements against Postgres even when the queue is empty (24 statements measured on dev with no schedule due, about 40 when the minute sweep fires), so Neon's five minute scale-to-zero never triggers and the compute runs 730 hours a month at the 0.25 CU floor. At the Launch rate fetched today that is a fixed floor of about 19 dollars a month for a workload whose real work fits in a few hours. The second driver is the two server-sent event streams every open tab holds: production logs show each one running to the 300 second Vercel timeout and reconnecting immediately, and the league stream runs a draft `advance` on a one second interval for the whole time the tab is open, which is two to three database queries per second per tab for any league whose draft is not complete. That loop is the largest per-user query source in the application and it runs for leagues whose draft is weeks away. The streams also keep at least one Fluid Compute instance alive around the clock, which at the iad1 memory rate is about 15 dollars a month before any user traffic.

The rest of the picture is healthier than the two headline items. The player peek is one query, verified on dev. The league room, home and matchup loaders are 5 to 12 queries each with no N+1 patterns, though the league home reads the whole matchups table for the league twice per request and nothing between requests is cached. The heaviest single reads are the draft room's player pool (2.9 MB on a cold instance, 0.7 MB warm, fetched once per tab per draft) and the league room's weekly projections read, which pulls one 35 KB to 970 KB jsonb capture row per render. Storage is 1.17 GB on dev, two thirds of it historical observation rows the app never reads at request time, which at 0.35 dollars per GB-month is not a cost lever. Migrations in the build are cheap, but the same `DATABASE_URL` is scoped to Preview deployments, so a preview build migrates and serves from the production database. The hosting comparison in section 8 concludes that staying on Neon and applying findings 1 through 3 is cheaper than every fixed-size option priced today, and names the traffic levels that would flip that.

## Findings, ranked by estimated cost impact

### 1. The minute cron never lets Neon compute suspend

**What.** `vercel.json` schedules `/api/jobs/tick` at `* * * * *` (read from project settings, crons enabled, definition confirmed on the live deployment). Every tick, `runTick` evaluates all nine schedules (`src/jobs/schedules.ts`), reclaims stale jobs, claims from the queue, and executes the `draft-sweep-minutely` fire. Neon suspends after five minutes of inactivity on Free and Launch (fetched today, `https://neon.com/docs/introduction/plans`), so a sixty second cadence keeps the compute active all day.

**Evidence.**
- Measured on dev: a tick with nothing due issues 20 queries plus 4 transaction control statements. 18 of the 20 are the schedule cursor read and write, one select and one update per schedule, nine schedules. The other two are the reclaim scan and the empty claim.
- Measured on dev: a tick where the minute sweep fires and executes ran 44 queries plus 12 transaction control statements for two sweeps (the cursor was two minutes old). Derived: a steady one-sweep minute is about 32 queries and 8 transaction control statements.
- Read from logs: `/api/jobs/tick` returned 200 at 60 second spacing across the whole window, from the cron host, source alternating between edge-middleware and serverless entries.
- Counted from code: `JOBS_CONFIG.staleAfterMs` 120000, `heartbeatIntervalMs` 10000, the sweep's `liveDraftsQuery` plus `autoStartDueDrafts` plus `startDueMockRooms` (five reads on dev, table list `drafts`, `leagues`, `teams`, `mock_rooms`).

**Estimated impact.** Compute never scales to zero, so the month is 730 hours at the 0.25 CU minimum, 182.5 CU-hours. At the Launch rate of 0.106 dollars per CU-hour fetched today that is 19.35 dollars a month as a floor, regardless of users. On the Free plan's 100 CU-hour allowance the compute allowance is exhausted on day 17. Statement volume from the cron alone is about 1,440 times 40, roughly 57,600 statements a day with zero users (derived from the dev measurement). Assumption: the production compute stays at the 0.25 CU floor under this load, which the tick's query shapes (single-row reads on tiny tables) support.

**Proposed fix.** Keep the minute cron (Vercel's minimum) but stop the tick from touching Postgres when there is nothing to do.
- Evaluate schedules in memory first. `fireInstantsBetween` already parses the cron expressions without a database. Compute the next fire instant for each schedule from the expression and only read the `schedule_cursors` row when the current minute is a fire minute or when the last successful cursor write (kept in module memory, one per warm instance) is older than the catch-up window. That removes 18 of the 20 idle statements.
- Gate the draft sweep on a Redis flag. The draft store already publishes every state change to Redis (`src/lib/realtime/publish.ts`). Have `startDraft`, `applyAction`, `autoStartDueDrafts` and the mock room start write a key such as `drafts:attention-until` holding the earliest kickoff or clock deadline, and have the sweep skip Postgres entirely when that key says nothing is due within the next sweep interval. The sweep stays level triggered and correct, because any state change rewrites the key.
- Skip the reclaim scan unless a claim happened in the last `staleAfterMs` (a Redis counter or an in-memory timestamp on the warm instance).
- With those three, an idle minute costs zero Postgres statements and the compute can suspend between real fires.

**Effort.** One to two days, most of it tests for the in-memory schedule evaluation. **Risk.** Low. The catch-up semantics are unchanged because the cursor row is still written whenever a fire is enqueued. The reclaim skip must fail open (scan) when Redis is unreachable.

**Estimated saving.** With the tick gated, daily wake-ups are the 18 harvest fires, three nightly jobs and the weekly and Tuesday to Thursday passes, about 22 a day. At one minute of work plus the five minute suspend delay each, that is 2.2 compute hours a day, plus interactive traffic. Assuming six hours a day of user sessions today, the month is about 246 hours at 0.25 CU, 61.5 CU-hours, 6.5 dollars on Launch, and inside the Free allowance. Saving about 13 dollars a month at today's scale, about two thirds of the compute bill. This is an estimate with the session-hours assumption stated.

### 2. The league event stream polls the draft every second for the life of the tab

**What.** `GET /api/leagues/[leagueId]/events` (`route.ts`, `maxDuration = 300`) calls `startDraftAdvanceLoopForLeague`, which runs `getDraftAdvancer().advance(draftId)` on `DRAFT_ADVANCE_CONFIG.sseIntervalMs` (1000 ms, counted from code in `src/draft-service/config.ts`) until the stream aborts. `draftLoopTarget` returns a draft id for every draft whose status is not `complete` or `dissolved`, so a league with a draft scheduled a month out polls as hard as a live draft.

**Evidence.**
- Read from logs: `/api/leagues/01b8059a-.../events` logged `Vercel Runtime Timeout Error: Task timed out after 300 seconds` at 1788824774, 1788825078, 1788825381, then the client reconnected each time, so one session held the stream open continuously.
- Measured on dev: a no-op `advance` on a completed draft is 2 queries (status read, then `max(sequence)` on `draft_actions` to validate the cached state). Counted from code: an in-progress draft with nothing due is 3 queries per call (status, `max(sequence)`, and the nudger's `isBotOwned` join), 4 inside the nudge window. A scheduled draft is 3 (status, `max(sequence)`, `dueDraftsQuery`).
- Counted from code: `REALTIME_CONFIG.keepaliveMs` 15000, `maxStreamsPerUser` 10, and the client (`use-live-scores.ts`) opens one shared `EventSource` per league url. `sse.ts` itself is Redis only, no database reads.

**Estimated impact.** Two to three queries a second per open league tab, 172,800 to 259,200 statements a day per tab, for as long as the draft is scheduled or in progress. During a real draft with twelve human tabs open for two hours that is 12 times 7200 times 3, about 260,000 statements from polling alone, against about 180 picks of real work. Each query returns a single small row, so egress is small (about 200 bytes a row, roughly 50 MB a day per tab, estimated), but it is the single largest statement source in the application and it keeps compute awake during every hour anyone has a room open. Assumption: the loop is active for every non-complete draft, per the `draftLoopTarget` predicate.

**Proposed fix.** Make the loop deadline driven instead of interval driven.
- `currentDeadline(state)` is already available in the loop's own advancer. Sleep until `min(deadline, nextBotPickDue, kickoffAt)` minus a small margin rather than polling every second. Draft state changes arrive on the Redis stream the same function is already subscribed to, so a pick by another seat can reset the timer without a database read.
- Do not start the loop at all when the draft is `scheduled` and kickoff is more than one sweep interval away. The minute sweep (finding 1) is the backstop that already exists for that case.
- Replace the `max(sequence)` cache check with the sequence carried on the last Redis event, so a warm instance serves `getDraftState` with no query when nothing has changed.

**Effort.** Two days including the timer tests. **Risk.** Medium. The one second poll is the reason mock drafts feel instant on Vercel (the 2026-09-03 stall incident), so the deadline timer must include the bot think delay and must fall back to a short poll if the Redis subscription drops. Keep `advance-on-read` untouched.

### 3. Two 300 second streams per tab keep a Fluid Compute instance alive all day

**What.** Every app tab opens `/api/notices/stream` and, in a league room, `/api/leagues/[id]/events`. Both are `maxDuration = 300` node functions that stream until Vercel kills them, then the browser reconnects. Fluid Compute bills provisioned memory for the entire instance lifetime, including time waiting on I/O (fetched today, `https://vercel.com/docs/functions/usage-and-pricing`), and the default function size on Pro is 2 GB (fetched today, `https://vercel.com/docs/functions/configuring-functions/memory`).

**Evidence.** Read from logs: both stream paths logged the 300 second timeout error back to back for the whole window (`/api/notices/stream` at 1788824737, 1788825040, 1788825344), each followed within a second by a reconnect that fetched `/api/notices` and, for the league stream, `/api/drafts/{id}`. Read from project settings: `fluid: true`, `functionDefaultTimeout: 300`, `functionDefaultMemoryType: standard`.

**Estimated impact.** One instance alive 24 hours a day at 2 GB is 48 GB-hours a day, 1,440 GB-hours a month, 15.26 dollars at the iad1 rate of 0.0106 dollars per GB-hour fetched today. Fluid's optimized concurrency lets many streams share one instance, so this is a floor that a single always-open tab already reaches, not a per-tab cost. Ten times the concurrent tabs would likely need two to three instances, 30 to 45 dollars a month (estimate, assuming Vercel packs streams onto instances at its default concurrency). The 300 second timeouts also write 576 error log lines a day per tab and count as errors in the dashboard. Invocations are negligible (288 a day per stream per tab, billed at 0.60 dollars per million).

**Proposed fix.**
- Collapse to one stream per tab. The user notice stream can carry league events for the league the tab is viewing (subscribe to two Redis stream keys inside one function), halving the alive time and the reconnect storms.
- End the stream gracefully at about 280 seconds with a retry hint rather than letting Vercel kill it, so the reconnect is planned and the error log line disappears.
- Close the `EventSource` when the tab has been hidden for more than 60 seconds (`visibilitychange`) and reopen on focus. Most always-open time is background tabs.
- Move the reconnect-time refetches (`/api/notices`, `/api/drafts/{id}`) behind the `last-event-id` cursor so a planned reconnect within the catch-up window does not refetch at all.

**Effort.** One day for the server side, half a day for the client. **Risk.** Low. The Redis stream keeps a 60 minute catch-up window (`catchUpWindowMs`), so a planned close loses nothing.

### 4. The hourly capture harvest dead-letters 18 times a day in production

**What.** `capture-harvest-hourly` fires 18 times a day (`HARVEST_CONFIG.cron` `0 2,7-23 * * *`). In production `TANK01_API_KEY` is not set (read from project settings: absent from `vercel env ls`), so every fire enqueues, claims, runs one step, throws a terminal error and dead-letters.

**Evidence.** Read from logs: `[jobs] DEAD-LETTER: job 5571 "capture-harvest" failed terminally on attempt 1 (terminal): capture-harvest: TANK01_API_KEY is not set`. Counted from code: the enqueue, claim transaction, `completedStepsFor`, and the failure transaction are about 12 statements plus three rows written (`jobs`, `job_runs`, `job_run_steps`) per fire.

**Estimated impact.** Small in statements (about 216 a day) and rows (54 a day, about 20,000 a year with the error text stored twice). The larger point is that the feature the schedule exists for (injury designations reaching the peek within the hour) is not running in production at all, and the job id in the log (5571) shows the queue has been accumulating dead letters since deploy.

**Proposed fix.** Either set the key in production (the founder approved the paid tier) or make `capture-harvest-hourly` self-disable when the provider is unconfigured the way `props-preseason-snapshot` self-disables after kickoff: the schedule evaluator checks a `enabled(env)` predicate before enqueueing. Then prune the dead-letter rows once. **Effort.** One hour. **Risk.** None.

### 5. Preview deployments migrate and serve from the production database

**What.** `vercel.json` sets `buildCommand` to `npm run build:vercel`, which runs `drizzle-kit migrate` before `next build`. `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are scoped to both Production and Preview (read from project settings). A preview build therefore applies any migration on its branch to the production database, and preview functions read and write production rows.

**Evidence.** Read from project settings: `DATABASE_URL Production, Preview`. Counted from code: `migrationDatabaseUrl` prefers `DATABASE_URL_UNPOOLED`, so the migration opens a direct connection, one per build. Six production builds ran on 2026-09-07 (read from `vercel ls`), two of them failed, all of them woke the compute (irrelevant today because finding 1 keeps it awake anyway).

**Estimated impact.** Cost is minor (one direct connection and one `__drizzle_migrations` read per build). Risk is not minor: a branch migration lands on production before review. This is also the reason Neon branching is worth having, which weighs in section 8.

**Proposed fix.** Use the Neon Vercel integration's per-preview branch (it sets a branch-scoped `DATABASE_URL` for Preview automatically) or remove Preview from the two variables and let preview builds skip `drizzle-kit migrate` when `VERCEL_ENV !== "production"`. **Effort.** One hour. **Risk.** Low.

### 6. The draft player pool is the heaviest read, 2.9 MB cold and 0.7 MB warm

**What.** `GET /api/drafts/[draftId]/players` calls `rankedPlayers`, which reads the entire `players` table and every `player_stat_lines` row for weeks 1 to 18 and sums fantasy points in JavaScript, then `boardReasons`, which reads every `preseason_board_reasons` row for the current source and season, and `nflPlayerIdsFor`, which reads the crosswalk for every player id.

**Evidence.** Measured on dev: cold instance 7 queries reading `players` (1,719 rows, 184 KB), `player_stat_lines` (12,189 rows, 1.9 MB), `preseason_board_reasons` (3,631 rows, 628 KB), `player_crosswalk`, `nfl_games` and `scoring_settings`. Warm instance 3 queries, 0.7 MB, because `rankedPlayers` caches per league in process but `boardReasons` and the crosswalk do not. Counted from code: the client fetches this once per draft per tab (`needsPlayers` in `use-draft-room.ts`), not per pick.

**Estimated impact.** A 12 team draft is about 12 tabs times 0.7 to 2.9 MB, 8 to 35 MB of egress per draft. Under Launch's 500 GB allowance this is not a bill today, but on Free's 5 GB it is 150 to 600 drafts a month, and the earlier data-transfer quota incident shows that allowance is the one that bites. The 1.9 MB stat line read per cold instance per league is the wasteful part: the sum could be one aggregate query returning 1,719 rows.

**Proposed fix.** Replace the raw stat line read with `select player_id, sum(points) group by player_id` computed in SQL against the league's scoring rules (or precompute per scoring hash the way `player_peek_documents` does, since the ranking only changes when stats or rules change). Cache `boardReasons` per (source, season) in process with a one hour TTL. Store the crosswalk map in the same cache. **Effort.** Half a day. **Risk.** Low, the ranking is deterministic and already snapshot at draft start.

### 7. The league room render reads one capture jsonb row and no request-level cache exists

**What.** `loadRoomData` for a completed-draft league runs `leagueHome` (12 queries measured on dev) plus `readPreferences`, then ten loaders in parallel including `weeklyProjectionsByPlayerId`, which reads the newest `tank01_projections` capture row's whole `payload` (35 KB average on dev, but `capture_snapshots` rows average 126 KB and reach 970 KB for other sources). `leagueHome` reads the league's whole `matchups` table twice in one request (measured, the identical select appears at positions 2 and 11 of the 12).

**Evidence.** Measured on dev: `league-home` 12 queries, a second identical call also 12, `cross-league-home` 8, `my-leagues-overview` 4, `matchup-week` 5, `player-peek` 1 (verified, both calls). Counted from code: at least 25 queries per league room render including the ten parallel loaders. Counted from code: zero uses of `unstable_cache`, `revalidateTag`, `"use cache"` or React `cache()` anywhere in `src`, and 103 routes declare `force-dynamic`.

**Estimated impact.** Per render, 25 to 30 statements and roughly 50 to 100 KB of egress, mostly the capture payload. Not a large bill at today's traffic. It matters at ten times the traffic and it is the easiest class to fix.

**Proposed fix.**
- Wrap the reference reads that do not vary per user (`byeWeeksByTeam`, `fixtureLabelsByTeam`, `weeklyProjectionsByPlayerId`, `boardReasons`, `scoringSettings` for a league) in `unstable_cache` keyed by week or scoring hash, with `revalidateTag` called by the job that writes them (the harvest and season-week jobs). These change hourly at most.
- Parse the projections payload once at write time into a narrow `player_week_projections` table (player id, week, points), so the room reads 1,700 short rows instead of a jsonb blob, or fold it into the peek document precompute.
- Deduplicate the `matchups` read in `leagueHome` (pass the rows from the first read to the second consumer).
- Extend the `player_peek_documents` pattern to the league home: a per-league `league_home_documents` row rebuilt by the scoreboard step of `season-week` and invalidated on lineup or trade writes would make the room one query the way the peek is.

**Effort.** One day for the cache wrappers and the dedupe, two days for the projections table. **Risk.** Low for the cache wrappers because the writers are already jobs with a clear place to call `revalidateTag`.

### 8. Pool size and driver on a serverless instance

**What.** `createDb` uses `postgres.js` over TCP with `max` 19 per instance (computed from `DB_POOL_CONFIG`: (100 minus 3 minus 5 times 4) divided by 4), no `idle_timeout`, no `connect_timeout`, `prepare: false`. Whether production `DATABASE_URL` points at the `-pooler` host could not be verified: the variable is stored as Sensitive and `vercel env pull` returns the literal `[SENSITIVE]`. The variable set (`DATABASE_PGHOST_UNPOOLED`, `DATABASE_POSTGRES_URL_NON_POOLING` beside `DATABASE_URL`) is the shape the Neon Vercel integration writes, and that integration sets `DATABASE_URL` to the pooled host, so it is very likely pooled. Verify in the Neon console, not by printing the value.

**Evidence.** Counted from code in `src/db/client.ts` and `src/db/config.ts`. Read from project settings: the variable names above.

**Estimated impact.** Not a direct bill. Nineteen idle TCP connections per warm instance is more than a serverless function ever uses (every measured loader ran on at most three connections in parallel) and each connection is a TLS handshake against Neon on a cold instance. With finding 1 fixed, idle connections that never time out would keep sockets open into a compute that wants to suspend. Neon's docs do not state that idle connections block suspension, so this is a hygiene item, not a savings figure.

**Proposed fix.** On Vercel, set `max` to 5, `idle_timeout` to 20 seconds, `connect_timeout` to 10, and `max_lifetime` to about 30 minutes, keeping the formula for the long-lived local process. Do not switch to the Neon HTTP driver: 95 `db.transaction` call sites and the `FOR UPDATE SKIP LOCKED` claim need a session, and Fluid Compute reuses instances, so TCP pooling through the `-pooler` endpoint is the right shape. **Effort.** One hour. **Risk.** Low.

### 9. Storage, retention and unused indexes

**What.** Dev database 1,172 MB across 72 tables and 161 indexes. `player_week_observations` 798 MB (3.01 million rows), `team_week_observations` 65 MB, `player_peek_documents` 62 MB (39 MB TOAST, 15,471 rows, `KEEP_GENERATIONS` 3), `preseason_board_reasons` 57 MB (180,790 rows across 10 source versions and two seasons, only one source and season read at runtime), `audit_events` 27 MB, `capture_snapshots` 8.5 MB in 66 rows. Twenty indexes have zero scans on dev, the largest `nfl_players_espn_id_idx` (1.6 MB) and `nfl_players_pfr_id_idx` (1.3 MB).

**Evidence.** Measured on dev with `pg_total_relation_size`, `pg_stat_user_tables` and `pg_stat_user_indexes`. Dev statistics were never reset, so scan counts are cumulative and the unused-index list is indicative only. Production sizes were not read (prod is for one verification read only, and this audit did not spend it).

**Estimated impact.** At Neon's 0.35 dollars per GB-month fetched today, 1.2 GB is 0.42 dollars a month. The harvest writes about 90 capture rows a day at 126 KB average, about 11 MB a day, 4 GB a year, 1.40 dollars a month by next September. Storage is not a lever this year.

**Proposed fix.** Prune `preseason_board_reasons` to the source versions still referenced (frees about 50 MB). Keep the observation stores as they are, they are the research asset. Confirm the two `nfl_players` indexes are unused with one `pg_stat_user_indexes` read on production before dropping. Add a retention rule for `capture_snapshots` that keeps the newest row per source per day past 90 days. **Effort.** Two hours. **Risk.** Low.

### 10. Migrations in the build

**What.** `drizzle-kit migrate` runs on every deploy over the unpooled URL. 85 journal entries, 42 files create indexes, one uses `CONCURRENTLY`, none run data backfills larger than seed rows.

**Evidence.** Counted from `drizzle/meta/_journal.json` and `drizzle/*.sql`.

**Estimated impact.** One direct connection and one read of `drizzle.__drizzle_migrations` per build, a few seconds of compute. Negligible while finding 1 keeps the compute awake, and still negligible after.

**Proposed fix.** None needed for cost. For future migrations on the observation tables use `CREATE INDEX CONCURRENTLY` outside the transaction so a deploy does not lock a 3 million row table.

## Every scheduled wake-up

| Source | Cadence | Fires per day | Statements per fire | Basis | Blocks suspend |
| --- | --- | --- | --- | --- | --- |
| Vercel cron `/api/jobs/tick` | every minute | 1,440 | 24 idle, about 40 with the sweep | measured on dev | yes, continuously |
| `draft-sweep-minutely` (inside the tick) | every minute | 1,440 | about 13 plus 8 transaction control | derived from the two-sweep measurement | yes |
| `capture-harvest-hourly` | 02:00 and 07:00 to 23:00 ET | 18 | about 12 (dead-letters today, finding 4) | counted from code, read from logs | one minute each |
| `adp-snapshot-nightly` | 03:00 ET | 1 | about 15 plus one insert per player row | counted from code | one minute |
| `props-preseason-snapshot-daily` | 03:30 ET | 1 | self-disables after kickoff | counted from code | one minute |
| `capsule-sweep-nightly` | 04:00 ET | 1 | reads every board player's facts and capsule, writes changed ones, enqueues peek rebuilds | counted from code | tens of minutes (LLM paced) |
| `season-week-tue-data` | Tue 08:00 ET | 1 a week | eight checkpointed steps, whole-week ingest and grade | counted from code | tens of minutes |
| `season-week-wed-data` | Wed 18:00 ET | 1 a week | same | counted from code | tens of minutes |
| `season-week-thu-freeze` | Thu 14:00 ET | 1 a week | same | counted from code | tens of minutes |
| `win-totals-weekly` | Wed 05:00 ET | 1 a week | skips after kickoff | counted from code | one minute |
| `peek-document` rebuilds | enqueued by harvest and capsule sweep | variable | one read, one write per player, plus the generation prune | counted from code | rides the parent |
| League event stream advance loop | every second per open tab | 86,400 per tab | 2 to 4 | measured on dev, counted from code | yes while any tab is open |
| Stream reconnects (`/api/notices`, `/api/drafts/{id}`) | every 300 s per tab | 288 per stream per tab | 2 and 5 | read from logs, measured on dev | rides the loop |
| `vercel build` migration | per deploy (6 on 2026-09-07) | variable | 1 read, 0 to a few DDL | counted from code | one minute |

Share of the day the compute cannot suspend today: 100 percent (the tick alone). After finding 1 and finding 2: about 22 wake-ups of six minutes, 9 percent of the day, plus whatever hours users are present (estimate).

## The ten heaviest queries

Ranked by rows times width times frequency. Widths measured on dev with `pg_column_size`.

| Rank | Query | Where | Rows times width | Frequency | Basis |
| --- | --- | --- | --- | --- | --- |
| 1 | Advance loop no-op (`drafts.status`, `max(draft_actions.sequence)`, `teams` join `users` for bot check) | SSE league stream | 3 rows, about 200 B | every second per open tab | measured on dev, counted from code |
| 2 | `player_stat_lines` weeks 1 to 18, whole table | `rankedPlayers`, draft players route | 12,189 rows, 1.9 MB | once per cold instance per league | measured on dev |
| 3 | `preseason_board_reasons` for current source and season | `boardReasons`, draft players route | 3,631 rows, 628 KB | every players request (once per tab per draft) | measured on dev |
| 4 | Schedule cursor select and update, nine schedules | job tick | 18 rows, about 2 KB | every minute | measured on dev |
| 5 | Newest `capture_snapshots.payload` for `tank01_projections` | league room render, team page | 1 row, 35 KB (126 KB average across sources, 970 KB max) | every league room render | measured on dev |
| 6 | `draft_actions` full replay for a draft | draft state cold load | 113 rows average, 181 max, 303 B each, about 34 KB | once per cold instance per draft | measured on dev |
| 7 | `players` whole table | `rankedPlayers`, capsules, advisor context | 1,719 rows, 184 KB | once per cold instance per league | measured on dev |
| 8 | `player_crosswalk` for every player id | draft players route | 1,719 rows | every players request | measured on dev |
| 9 | `matchups` for the league, twice | `leagueHome` | 2 times the league's matchup rows | every league home and room render | measured on dev |
| 10 | `jobs` claim scan with `FOR UPDATE SKIP LOCKED` and the `running` reclaim scan | job tick | full-row selects, 0 to 1 rows | twice a minute | measured on dev |

Verified single-query surfaces: the player peek (`player_peek_documents.document` joined to `leagues.is_mock`, one statement, 2.2 KB average document).

## Hosting comparison: stay on Neon serverless or move to a fixed-size Postgres

### Workload profile

| Dimension | Value today | Basis |
| --- | --- | --- |
| Job ticks | 1,440 requests a day, 24 to 40 statements each, about 57,600 statements a day | read from logs (cadence), measured on dev (statements) |
| Interactive rooms | one active session observed in the log window, 2 streams held open continuously, reconnect every 300 s, each reconnect 7 queries | read from logs, measured on dev |
| Advance loop | 2 to 4 statements a second per open league tab while the draft is scheduled or in progress | measured on dev, counted from code |
| Board (draft players) | 0.7 MB warm, 2.9 MB cold, once per tab per draft | measured on dev, counted from code |
| Peek | 1 query, 2.2 KB | measured on dev |
| Other API and pages | 4 to 30 queries per request, single small rows | measured on dev, counted from code |
| Crons and nightly writes | 18 harvest fires (90 upstream requests, 90 capture rows, about 11 MB a day), 3 nightly jobs, 3 weekly passes, capsule regeneration paced by the LLM | counted from code |
| Peak concurrency | unknown in production, no aggregate log access (see the unmeasured list). Design assumption for a season-launch year: 20 simultaneous drafts of 12 tabs, 240 open league streams, 720 statements a second under the current loop, about 30 a second after finding 2 | estimated |
| Storage | 1.17 GB on dev, growing about 4 GB a year from captures plus observations backfilled per season | measured on dev |
| Egress per day | under 100 MB today (tick 7 MB, loops about 50 MB per tab, renders and boards the rest) | estimated from measured widths and observed cadence |
| Daily shape | a floor of 1,440 wake-ups all day from the tick, hourly harvest bumps 07:00 to 23:00 ET, a 02:00 to 04:00 ET nightly write window, draft-night bursts of second-scale polling, Sunday scoring bursts once live ingestion runs | read from logs and counted from code |

Ten times the room traffic is modelled as ten times the open tabs and drafts, not ten times the crons, since the crons are fixed.

### Candidates and prices (fetched 2026-09-07)

- **Neon** (`https://neon.com/pricing` and `https://neon.com/docs/introduction/plans`, fetched today). Free: 100 CU-hours, 0.5 GB storage, 5 GB transfer, scale to zero fixed at 5 minutes. Launch: 0.106 dollars per CU-hour, 0.35 dollars per GB-month, 500 GB transfer included then 0.10 dollars per GB, 0.25 CU minimum, scale to zero after 5 minutes or disabled. Scale: 0.222 dollars per CU-hour, suspend configurable from 1 minute to always on. Cold start after suspend: "within a few hundred milliseconds" (`https://neon.com/docs/introduction/scale-to-zero`, fetched today).
- **Supabase** (`https://supabase.com/pricing` and `https://supabase.com/docs/guides/database/connecting-to-postgres`, fetched today). Pro 25 dollars a month with 10 dollars of compute credit that covers a Micro (2-core ARM, 1 GB, 60 direct and 200 pooler connections). Small 15 dollars (2 GB, 400 pooler), Medium 60 dollars (4 GB), Large 110 dollars (8 GB). 8 GB disk included then 0.125 dollars per GB, 250 GB egress then 0.09 dollars per GB. Supavisor transaction mode on port 6543 is the documented path for serverless and "does not support prepared statements", which this codebase already handles with `prepare: false`. Direct connections are IPv6, so Vercel builds should migrate over the session-mode pooler or buy the IPv4 add-on (price not on the fetched page).
- **Railway** (`https://railway.com/pricing`, fetched today). Hobby 5 dollars a month including 5 dollars of usage, Pro 20 dollars. Usage: 0.00000772 dollars per vCPU-second (about 0.0278 dollars per vCPU-hour), 0.00000386 dollars per GB-second of memory (about 0.0139 dollars per GB-hour), volumes about 0.15 dollars per GB-month, egress 0.05 dollars per GB. Postgres is a template on a volume, no managed pooler, backups are a volume feature.
- **Fly.io Managed Postgres** (`https://fly.io/mpg/`, fetched today). Basic 38 dollars (shared-2x, 1 GB), Starter 72 dollars (2 GB), Launch 282 dollars (8 GB). Storage 0.28 dollars per provisioned GB, 10 GB minimum. All plans include HA, backups and PgBouncer.
- **DigitalOcean Managed PostgreSQL** (`https://www.digitalocean.com/pricing/managed-databases`, fetched today). 1 GiB, 1 vCPU, 10 GiB: 15.15 dollars a month. 2 GiB: 30.45 dollars. Storage 0.215 dollars per GiB-month in 10 GiB steps. Connection pooling and daily backups are part of the product, egress rules were not on the page.
- **AWS Lightsail managed database** (`https://aws.amazon.com/lightsail/pricing/`, fetched today). 1 GB, 1 core, 40 GB SSD, 100 GB transfer: 15 dollars a month, no encryption at that tier. 2 GB with encryption 30 dollars. Inbound and outbound both count against the transfer allowance. No pooler.
- **AWS RDS PostgreSQL**. `db.t4g.micro` 0.016 dollars an hour, about 11.68 dollars a month (search result summary citing `https://instances.vantage.sh/aws/rds/db.t4g.micro`, fetched today). `db.t4g.medium` 47.45 dollars a month on demand, quoted for us-west-2 (`https://aiven.io/tools/instances/db.t4g.medium`, fetched today). The RDS pricing page itself renders its tables client side and could not be extracted, so gp3 storage (about 2 to 3 dollars at 20 GB) and RDS Proxy (a per-vCPU-hour floor) are estimates and are marked so.
- **Vercel Postgres**. Sunset. Vercel Postgres stores were moved to Neon in December 2024 and the product was deprecated in June 2025 (`https://vercel.com/docs/postgres` and `https://neon.com/docs/guides/vercel-postgres-transition-guide`, search fetched today). The marketplace replacement is the same Neon product this audit is on, so it is not a separate candidate.
- **Vercel Fluid Compute** for the function-hour arithmetic (`https://vercel.com/docs/functions/usage-and-pricing`, fetched today): iad1 active CPU 0.128 dollars an hour, provisioned memory 0.0106 dollars per GB-hour, invocations 0.60 dollars per million on Pro, Pro includes 20 dollars of monthly credit (`https://vercel.com/docs/plans/pro-plan`, fetched today). The Vercel side is identical across every database candidate and is listed only so the database bill is seen next to it.

### Comparison table

Monthly cost is computed from the workload profile, not the headline. "Today" uses the measured cadences, "10x" is ten times the open tabs and drafts with the crons unchanged. All figures are estimates unless a row says otherwise.

| Candidate | Today, as coded | Today, after findings 1 to 3 | 10x rooms, after findings 1 to 3 | Cold start and Vercel connection behavior | Operational load | Migration effort | Lock-in |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Neon Launch, scale to zero on (current) | 19.35 compute + 0.42 storage, about 20 | about 6.5 + 0.42, about 7 | about 16 (500 h at an average 0.3 CU) | Sub-second wake after suspend. Pooled `-pooler` endpoint, PgBouncer transaction mode, `prepare: false` already set. HTTP driver available but not needed. Same AWS region as iad1 when the project is in us-east-1 | Backups, upgrades, PITR and branches managed. Migrations in build already work | none | Postgres, but branching and scale to zero are Neon features the fixes lean on |
| Neon Launch, scale to zero off | 19.35 + 0.42 | 19.35 + 0.42 (no saving from finding 1) | about 25 | No cold start ever | same | none | same |
| Neon Scale, 1 minute suspend | 40.5 + 0.42 as coded | about 9 (fewer idle minutes per wake) | about 30 | Sub-second wake | same, plus standard support | none | same |
| Neon Free | over the 100 CU-hour allowance by day 17 as coded, and 1.2 GB exceeds 0.5 GB storage | 61.5 CU-hours fits the compute allowance, storage still does not fit | not viable | same as Launch | same | none | same |
| Supabase Pro Micro | 25 | 25 | 25 to 30 (Small if the pooler count is the limit) | Always on, no cold start. Supavisor transaction mode on 6543, `prepare: false` required (already set). us-east-1 available. Direct URL is IPv6 (migrations via session pooler or IPv4 add-on) | Backups daily, PITR add-on, upgrades scheduled by vendor, dashboard and auth we would not use | low: same Postgres, Drizzle unchanged, dump and restore, two env vars, verify PG 17 on the new project | Postgres only if we ignore the platform features |
| DigitalOcean 1 GiB | 15.15 | 15.15 | 30.45 (2 GiB) | Always on. Built-in PgBouncer pool. NYC region, near iad1 but a different provider network, add a few ms | Backups daily, upgrades on our schedule, no branching | low, same as above | none beyond Postgres |
| AWS Lightsail 1 GB | 15 | 15 | 30 (2 GB, encrypted) | Always on. No pooler, `max` 5 per instance would be the only pooling. Same region as iad1 | Backups automatic, no PITR, manual major upgrades, no encryption at the 1 GB tier | low | none |
| AWS RDS db.t4g.micro | about 14 (11.68 + gp3, estimate) plus a proxy if we want one | same | about 50 (t4g.medium) | Always on. RDS Proxy is the pooler and carries its own floor, without it the micro's connection ceiling is tight for serverless. Same region as iad1 | Highest ops load of the managed set (parameter groups, VPC or public access, IAM) | low to medium (networking) | none |
| Fly Managed Postgres Basic | 38 + 2.80 storage | same | 72 + storage (Starter) | Always on, PgBouncer included, HA included. iad region exists | Backups and HA managed | low | none |
| Railway Hobby | about 5 to 10 (mostly idle CPU and 300 MB resident, estimate) | same | about 10 to 20 | Always on. No managed pooler, no HA, egress 0.05 per GB. us-east available | Backups are volume snapshots, upgrades manual, single node | low | none |
| Vercel Postgres | not offered | | | | | | |

Notes on the table. The Vercel function-hour floor from finding 3 (about 15 dollars a month today) applies equally to every row and is not in the table. Neon "as coded" is the only column where the database bill is dominated by an application defect rather than by the plan.

### Recommendation: stay on Neon and apply findings 1 to 3

Reasoning.
- The database bill today is about 20 dollars a month and it is almost entirely the cron keeping compute awake. That is an application defect, and after finding 1 the same workload costs about 7 dollars a month. No fixed-size candidate is cheaper than 15 dollars, and the two nearest (DigitalOcean 1 GiB, Lightsail 1 GB) buy 1 GB of RAM with no branching and, for Lightsail, no pooler.
- The two costs that actually scale with users, the per-second advance loop and the always-alive stream function, are on the Vercel side and move with us to any database. Fixing them is worth more than any hosting change.
- Neon branching is the correct fix for finding 5 (preview deployments on the production database) and costs 1.50 dollars per branch-month. The fixed-size candidates need a second instance for the same isolation.
- Migration cost is low everywhere (plain Postgres, Drizzle, no extensions beyond core, no `CREATE EXTENSION` in 85 migrations, PG 17 on dev), so nothing is lost by staying now and moving later if a trigger fires.
- A hybrid (fixed primary, serverless read path) is not warranted. The read path is already one query for the peek and is cacheable at the Next layer for the rest. There is no read-replica pressure to split.

Trigger conditions that would flip the recommendation to a fixed instance (Supabase Small or DigitalOcean 2 GiB at about 30 dollars):
- Neon compute exceeds about 280 CU-hours a month for two consecutive months after findings 1 and 2 are live. That is 30 dollars on Launch, the price of the fixed alternatives with the same headroom, and it means in-season traffic keeps compute awake more than 16 hours a day at an average above 0.5 CU.
- Egress exceeds 500 GB a month (Neon overage 0.10 per GB versus Supabase 0.09 after 250 GB, roughly a wash, so this alone is a weak trigger unless it is sustained).
- The product needs always-on latency for the first request of the morning and the always-on floor on Neon (19.35 dollars at 0.25 CU, more if the minimum is raised for headroom) exceeds a fixed instance with equivalent RAM.
- The workload adopts logical replication out of Neon or an extension Neon does not ship.

Triggers that would move it to Neon Scale rather than off Neon: needing the 1 minute suspend delay to cut idle minutes further, or needing read replicas for the research jobs so the season-week passes stop competing with rooms.

## Quick wins under an hour each

1. Set `TANK01_API_KEY` in production or add a schedule `enabled` predicate so `capture-harvest-hourly` stops dead-lettering 18 times a day (finding 4).
2. Remove Preview from `DATABASE_URL` and `DATABASE_URL_UNPOOLED`, or turn on the Neon integration's preview branches, and skip `drizzle-kit migrate` when `VERCEL_ENV` is not `production` (finding 5).
3. Do not start the advance loop when the draft is `scheduled` and kickoff is more than two minutes away: one condition in `draftLoopTarget` (the largest part of finding 2 for the common case).
4. Skip the reclaim scan when no job has been claimed in the last two minutes, using a module-level timestamp on the warm instance with fail-open (part of finding 1).
5. Set `max` 5, `idle_timeout` 20 and `connect_timeout` 10 on the Vercel pool (finding 8).
6. Wrap `byeWeeksByTeam`, `fixtureLabelsByTeam` and `boardReasons` in `unstable_cache` keyed by week or season with a one hour revalidate (finding 7 and 6).
7. Deduplicate the second `matchups` read in `leagueHome` (finding 7).
8. End both SSE streams at 280 seconds with a `retry:` hint instead of letting Vercel time them out, removing 576 error log lines a day per tab (finding 3).
9. Prune `preseason_board_reasons` to the referenced source versions, about 50 MB (finding 9).
10. Verify in the Neon console that the production `DATABASE_URL` host ends in `-pooler`, and record the plan (Free or Launch) in `docs/decisions` so the next audit does not have to infer it (finding 8).

## What could not be measured, and why

- Production request counts by route over 24 hours. The Vercel MCP `get_runtime_logs` aggregate returned 403 and `get_project` returned 404 for this project even with the real ids, and the CLI's `vercel logs` caps at 100 recent lines. The profile uses a 25 minute production sample plus code-derived cadences.
- The Neon plan, compute size, autosuspend setting and the actual monthly CU-hours. The connection string is a Sensitive variable that `vercel env pull` returns as `[SENSITIVE]`, and the Neon console was not in scope. Every Neon figure uses the fetched Launch rates with the 0.25 CU minimum.
- Production table sizes and index usage. The rule for this audit was no repeated production reads, and the single verification read was kept in reserve. Dev sizes are the proxy and are labelled as such.
- Real Fluid Compute instance packing under concurrent streams. The instance-hour figures assume one always-alive instance today and two to three at ten times the tabs.
