/**
 * THE ONE-RUNNER ERA'S REPLACEMENT (Round D, Task 3 scope extension).
 *
 * Every DB-backed test truncates the whole schema between tests (`test-db.ts`'s own
 * `truncateAll`), which is why this repository has always run test FILES one at a time: two
 * files racing the same `TRUNCATE ... RESTART IDENTITY CASCADE` against one shared database is
 * not a flaky test, it is two tests sharing a database that was never built to be shared. FOUR
 * lane databases on the one `postgres-test` container (created and migrated by
 * `scripts/migrate-test-lanes.ts`, which `npm run db:migrate:test` runs) let `vitest run` shard
 * files across up to four parallel workers instead: each worker gets its own database, so
 * cross-worker interleaving is no longer possible for the SAME reason a single serial run was
 * always safe — one worker, one database, files still run one at a time within it.
 *
 * LANE 1 IS THE BASE DATABASE, UNCHANGED. Every existing default (`.env.local`'s
 * `TEST_DATABASE_URL`, docker-compose's `POSTGRES_DB: commish_test`) keeps naming `commish_test`
 * with no suffix, so `vitest run --no-file-parallelism` — which
 * Vitest resolves to exactly one worker, `VITEST_POOL_ID` "1" — reads and migrates the SAME
 * database it always has. Lanes 2-4 are `commish_test_2`, `commish_test_3`, `commish_test_4`.
 *
 * PURE AND VITEST-FREE ON PURPOSE. `scripts/migrate-test-lanes.ts` runs as a plain Node process
 * that never loads the `vitest` package, and `vitest.setup.mts` (which does) imports this SAME
 * module rather than the lane-naming rule being written twice and drifting.
 */
export const TEST_DB_LANE_COUNT = 4;

/**
 * Rewrites a Postgres connection URL's database name for a 1-based lane. Lane 1 returns `baseUrl`
 * untouched; lane N (2..`TEST_DB_LANE_COUNT`) appends `_N` to the database name, so
 * `postgres://.../commish_test` becomes `postgres://.../commish_test_2`, and so on.
 */
export function testDatabaseUrlForLane(baseUrl: string, lane: number): string {
  if (!Number.isInteger(lane) || lane < 1 || lane > TEST_DB_LANE_COUNT) {
    throw new Error(`Lane ${lane} is out of range (1-${TEST_DB_LANE_COUNT}).`);
  }
  if (lane === 1) return baseUrl;
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname}_${lane}`;
  return url.toString();
}

/**
 * Which lane THIS process should use.
 *
 * `TEST_DB_LANE` (an explicit env var — a manual run pinned to one lane, a CI job isolating a
 * single lane) wins outright when set. Otherwise `VITEST_POOL_ID`, which Vitest sets on every
 * worker (threads or forks) before that worker runs its first test file's `setupFiles` — the
 * exact per-worker identity this lane split exists to key off. Either source is wrapped into
 * `[1, TEST_DB_LANE_COUNT]` with modulo arithmetic so a worker pool wider than the lane count (a
 * future `maxWorkers` bump, a CI runner with more cores) still resolves to a real database rather
 * than a nonexistent `commish_test_7`. Falls back to lane 1 for every caller outside Vitest's
 * worker pool entirely (a one-off script, a REPL, `db:migrate:test`'s single-lane invocation) —
 * the same database every such caller has always used.
 */
export function currentTestDbLane(): number {
  const explicit = readLane(process.env.TEST_DB_LANE);
  if (explicit !== null) return explicit;

  const pooled = readLane(process.env.VITEST_POOL_ID);
  return pooled ?? 1;
}

function readLane(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return ((parsed - 1) % TEST_DB_LANE_COUNT) + 1;
}
