# Data layer hardening: decisions

**Phase 2, Plan A** · Spec: `plans/phase-2-accounts-and-data-foundation.md` Step 2

Decisions from this phase's data-layer hardening work. The first section below records findings
from the `src/db/index-plans.test.ts` EXPLAIN gate (Task 5) that affected which sequential-scan
assertions the gate makes. The sections after it (Task 8) cover the balance-as-rollup convention,
connection-pool sizing, PgBouncer transaction pooling and what it forbids, and the full index
list including what the spec asked for that was struck. Each entry records what was chosen, why,
and how it was verified — so a later change that makes one of these true again is a deliberate
decision to revisit, not a silent regression nobody explains.

## `teams` in the unnarrowed public browse: seq scan is the planner's genuine choice, not a missing index

**Query:** `browseQuery` (`src/league-service/browse.ts`) with `EMPTY_BROWSE_FILTER` — the
`leagues` ⋈ `drafts` ⋈ `teams` join with no format/experience/stake narrowing, against the
5,000-league / 15,000-team corpus seeded in `src/db/index-plans.test.ts`.

**Observed:** After adding `leagues_public_browse_idx` (migration `0011`), `leagues` is read by
index scan as expected. `teams` is still read by `Seq Scan` under the planner's default cost
model (`enable_seqscan` at its default `on`).

**Diagnosis:** Re-running the identical `EXPLAIN (ANALYZE, FORMAT JSON)` under
`SET LOCAL enable_seqscan = off` (diagnostic only — never how the test or production runs)
confirms an index path exists: the planner falls back to a `Nested Loop` with an `Index Scan`
on `teams` via `teams_league_id_idx`, at a *higher estimated* cost (1100.48 vs. 557.94) but
*lower measured* time — repeated cache-warm measurement puts the forced-index plan roughly
35-40% faster at this corpus size (median ~2.2ms vs ~3.6ms). The planner's estimate and the
measurement disagree because the default `random_page_cost` (4.0) prices random I/O for
spinning disks; on SSD-backed storage it overprices index access. We deliberately do NOT
force the plan here: the gap is milliseconds on an anonymous read, and the correct fix is
cost-model tuning (`random_page_cost`) alongside the pooling configuration, tracked as a
follow-up in this document rather than a planner hint scattered in query code.

At 5,000 leagues / 15,000 teams, the unnarrowed browse still matches roughly 500 leagues and
1,500 teams after the `is_public_matchmade` and `status = 'scheduled'` predicates. A `Seq Scan`
over the whole 15,000-row `teams` table, hashed once and probed 500 times, costs the planner
less than 1,500 individual index lookups — the classic "the qualifying set is a large enough
fraction of the small table that scanning it once beats an index" tradeoff. This is the
optimizer working as intended, not evidence of a missing or unused index: `teams_league_id_idx`
(added for this exact join in an earlier phase) demonstrably exists and demonstrably works —
narrowed browse queries and every other `teams` lookup in this suite use it.

**Decision:** `src/db/index-plans.test.ts`'s unnarrowed-browse assertion checks only that
`leagues` avoids a sequential scan; it does not assert the same for `teams`. Asserting a
planner's cost-based join strategy choice on a table this small would make the gate brittle
against normal data growth (the crossover point where Postgres prefers the index path moves as
`teams` grows) without protecting against any real regression — the index it would be asserting
on already exists and is exercised by every other test in the suite that reads `teams`
selectively (`teams.user_id`, and `teams` in the narrowed browse test).

**Revisit this if:** the corpus size assertions in `index-plans.test.ts` change materially, or
if `teams` grows large enough in production that this same query starts sequentially scanning it
in practice — at that point, re-run this diagnostic against real data before deciding whether the
join needs restructuring (e.g. filtering `teams` by the narrowed `leagues` set before the join)
rather than assuming the fix is "add an index," since one already exists.

**Plan D runbook note:** migrations `0011` (`leagues_public_browse_idx`, plain `CREATE INDEX`,
takes a `SHARE` lock blocking writes to `leagues`), `0012` (`player_stat_lines.sacks` widened
to `real`, `ALTER COLUMN ... TYPE`, takes `ACCESS EXCLUSIVE` and rewrites the table) and `0013`
(Plan B's `lineup_slots_player_week_idx` and `roster_slots_player_idx`, the two indexes
`affectedTeams` — `src/stats-pipeline/affected.ts` — reads; plain `CREATE INDEX`, each taking a
`SHARE` lock blocking writes to `lineup_slots`/`roster_slots` respectively while it builds) all
run as written here. Safe at current and near-term table sizes, and there is no production
database yet — but whoever runs these against a live table with real traffic should use `CREATE
INDEX CONCURRENTLY` for `0011` and `0013` and a batched backfill for `0012` instead of running
the checked-in SQL verbatim.

## The balance-as-rollup convention

**Rule.** Any running total in this product is maintained as a **rollup row, updated in the same
transaction as each contributing write**, over an **append-only source table that remains the
reconciliation source of truth**. A running total is never computed as a `SUM()` or a table scan
on the read path.

That is two obligations, not one:

1. The append-only table is never deleted from or updated in place. It is what an audit,
   a dispute, or a regulator reconstructs the total from, and it is what a corrupted rollup is
   rebuilt from.
2. The rollup is updated **inside the same transaction** as the write it summarizes. Not after
   it, not in a job, not on a schedule. A rollup that can be updated separately is a rollup that
   can disagree with its source, and a balance that disagrees with its ledger is the single worst
   failure a money product has.

**Why it is written down here, in a phase with no ledger.** Phase 4 introduces a payment ledger
and Phase 3 an audit log, and both are the shape that invites `SELECT sum(amount) FROM …` on
every read. Writing the convention after those tables exist means retrofitting it; writing it now
means those phases can follow it instead of re-deriving it. This file does not edit those phase
files — another process owns cross-file reconciliation.

**Applied in this phase.** The one aggregate-style read that exists is public browse's fill count.
It is now a grouped `count(teams.id)` with the open-seat rule as a `HAVING` predicate
(`src/league-service/browse.ts`), served by `leagues_public_browse_idx`, rather than a second
query folded in JavaScript over an already-capped page. `teams` is the append-only source; the
count is derived per query rather than stored, which is the correct call at this cardinality (a
league has at most a few dozen teams, and a stored counter would be a second thing to keep
honest). The convention's threshold is **unbounded growth**: derive a count over a bounded set,
roll up a total over an unbounded one. A payment ledger is unbounded. A league's roster is not.

## Connection-pool sizing

```
pool_size_per_instance = (postgres_max_connections
                          - reserved_superuser_connections
                          - background_job_pool_size * expected_max_instances)
                         / expected_max_instances
```

Executable as `requestPoolSizePerInstance()` in `src/db/config.ts`, with each input a named
field so changing a managed provider's `max_connections` changes one number and the pool sizes
follow. `src/db/config.test.ts` asserts that every instance's pool plus the background pool can
never exceed what Postgres will actually grant.

`background_job_pool_size` is subtracted **before** the division rather than carved out of one
instance's share, and it is subtracted `expected_max_instances` TIMES, because the background pool
is per instance rather than cluster-wide: `src/instrumentation.ts` starts an ingestion worker in
every Node process and each one opens its own pool. Subtracting it once was correct only while
there was exactly one background worker anywhere, which stopped being true the moment Plan B's
worker shipped — the old formula budgeted 4 x 23 + 5 = 97 connections while the deployment would
actually open 4 x 23 + 4 x 5 = 112, fifteen past what Postgres would grant. Corrected, it is 19 per
instance and 4 x (19 + 5) = 96. Plan B's stats-ingestion worker is that pool's first named consumer:
`ingestionPoolOptions()` (`src/stats-pipeline/index.ts`) hands `DB_POOL_CONFIG.backgroundJobPoolSize`
straight to the worker's own `createDb(undefined, ingestionPoolOptions())` call, a dedicated pool
it never shares with the request path's `getDb()`, and holds those connections for the length of
a poll cycle. `src/stats-pipeline/index.test.ts` asserts on `ingestionPoolOptions()` directly
(asserting on a live `postgres` pool's internals would mean asserting on `postgres` itself) — the
formula above is only true if the worker actually honors it, and that is what proves it does. A
batch job that can borrow from the request path's budget is a batch job that can take the request
path down on the busiest day of the week.

## PgBouncer, transaction pooling, and what it forbids

The app connects through PgBouncer in **transaction pooling** mode, locally
(`docker-compose.yml`, port 6432) and in the deployed environment (Plan D). A client is handed a
different backend between transactions, so **nothing may rely on session-scoped state**:

- **No `pg_advisory_lock`.** It is session-scoped. The per-draft lock is
  `SELECT … FOR UPDATE` on the `drafts` row, taken and released entirely inside one transaction
  (`src/draft-service/store.ts`). `src/db/pgbouncer.test.ts` proves the lock is released by the
  commit and immediately available to an independent client.
- **No named prepared statements.** `createDb` sets `prepare: false` unconditionally, on the
  direct connection as well as the pooled one, so a bug cannot hide behind a mode difference.
- **No `SET` outside a transaction**, no session-scoped temporary tables, no `LISTEN`/`NOTIFY`.
  The last one costs nothing here: real-time is Redis Streams over SSE and always has been.
- **No DDL through the pooler.** `npm run db:migrate` pins `DATABASE_URL` to the direct port
  (`postgres://…@localhost:5432/commish`), the same way `db:migrate:test` already pins the
  direct test port. `drizzle-kit migrate` opens its own connection, not `createDb`'s, so it never
  gets `prepare: false` — and PgBouncer's transaction pooling is the wrong transport for schema
  changes regardless: a migration's DDL can span multiple statements the pooler is free to spread
  across different backends between them.

Verification: `npm test -- src/db/pgbouncer`, plus the whole suite run through the pooler
(`TEST_DATABASE_URL=postgres://commish:commish@localhost:6433/commish_test npm test`) as a
release-gate step rather than a default, since a pooler in the path slows every test and can
disguise a regression as a pooling artifact.

**How this relates to the outstanding `random_page_cost` follow-up above.** The `teams` seq-scan
diagnosis noted the correct fix for that gap is planner cost-model tuning
(`random_page_cost`), tracked as a follow-up "alongside the pooling configuration." Pooling and
cost-model tuning are independent tunables — PgBouncer changes which backend a statement lands
on between transactions, not what the planner estimates a page fetch costs once it gets there —
so landing the pooler in this task does not by itself close that gap. It remains open: the
`random_page_cost` change is a single Postgres-instance-level setting, best made once (Plan D
provisions the real managed instance) and re-verified against the same diagnostic used above,
rather than tuned twice against a local container whose storage characteristics won't match
production's.

## The index list, including what was struck and why

**Added:** `leagues_public_browse_idx` — partial, `ON leagues (created_at) WHERE
is_public_matchmade`. The only table with no index beyond its primary key, and the one the app's
single unauthenticated endpoint filters and sorts on.

**Already present and verified by `src/db/index-plans.test.ts`:** `teams_league_id_idx`,
`teams_user_id_idx`, `teams_league_user_idx`, `chat_messages_league_id_idx (league_id, id)`,
`draft_actions_draft_id_id_idx`, `draft_actions_draft_sequence_idx`, `drafts_league_id_idx`
(unique), `drafts_status_idx`, `league_invites_league_id_idx`, `players_position_idx`,
`player_stat_lines_week_idx`, `users_email_idx`.

**Struck from the spec's list, with reasons:**

| Spec asked for | Why it is not built |
|---|---|
| `Session(token)`, `Session(userId)` | There is no `sessions` table and there will not be one. WorkOS AuthKit owns sessions; `users.id` **is** the WorkOS user id. Indexing a table that does not exist is not a deferral, it is a category error in the spec, which was written against a Phase 1 that planned hand-rolled auth. |
| chat messages by `(leagueId, createdAt)` | Already served, better, by `chat_messages_league_id_idx` on `(league_id, id)`. `id` is a `bigserial` that doubles as the page cursor, so a page is an index range scan with no timestamp tie to break. A `createdAt` index would be a second index serving strictly less. |
| `draft_actions(draftId, timestamp)` | Already served by `draft_actions_draft_id_id_idx` for the replay read and by the unique `draft_actions_draft_sequence_idx` for the append. Replay orders by `sequence`, never by `timestamp`. |
| An index on `leagues.commissioner_user_id` | Nothing filters on it. Every read fetches the league by primary key and compares in application code (`src/lib/leagues/membership.ts`, `src/league-service/read.ts`). Add it the day a "leagues I commission" query exists, not before. |

**How the list stays honest:** `src/db/index-plans.test.ts` seeds 5,000 leagues, 20,000 chat
messages and 400 draft actions, runs `ANALYZE`, and fails the build if any named hot path
sequential-scans. A plan assertion over a hundred rows asserts nothing, which is why the corpus
is that size.
