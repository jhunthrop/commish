# Data layer hardening: decisions

Findings from the `src/db/index-plans.test.ts` EXPLAIN gate (Task 5 of Phase 2 Plan A) that
affected which sequential-scan assertions the gate makes. Each entry records what the planner
chose, why, and how it was verified — so a later change that makes one of these true again is a
deliberate decision to revisit, not a silent regression nobody explains.

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
