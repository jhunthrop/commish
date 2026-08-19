/**
 * Postgres connection-pool tunables, with the arithmetic that produced them.
 *
 * Phase 1 left `defaultMaxConnections: 10` as a round number with no methodology behind it, and
 * the Phase 2 spec calls that out as a placeholder. The number that matters is not "how many
 * connections does one process want" but "how many can every process that will exist take at
 * once without any of them being refused", which is a division, so it is written as one:
 *
 *   pool_size_per_instance = (postgres_max_connections
 *                             - reserved_superuser_connections
 *                             - background_job_pool_size) / expected_max_instances
 *
 * `background_job_pool_size` is subtracted BEFORE the division, not carved out of one
 * instance's share, because it is a separate pool with a separate lifetime: Plan B's
 * stats-ingestion worker holds connections for the length of a poll cycle, and a batch job that
 * can borrow from the request path's budget is a batch job that can take the request path down
 * on the busiest day of the week. Reserving it up front is what makes "a batch can never starve
 * a request" arithmetic rather than a hope.
 *
 * The three inputs are Postgres's own defaults today (`max_connections = 100`,
 * `superuser_reserved_connections = 3`) plus this product's own scaling ceiling for the phase.
 * When Plan D provisions a managed Postgres with a different `max_connections`, change the
 * number HERE and the pool sizes follow — that is the whole reason it is a formula.
 */
export const DB_POOL_CONFIG = {
  /** Postgres's `max_connections`. The docker-compose image ships the default; Plan D's managed instance must be checked and this updated to match. */
  postgresMaxConnections: 100,
  /** Postgres's `superuser_reserved_connections`. Left for an operator to get in during an incident. */
  reservedSuperuserConnections: 3,
  /** How many app instances may run at once this phase. Plan D's hosting sets the real ceiling. */
  expectedMaxInstances: 4,
  /** The separate pool background/batch work uses, subtracted from the budget before the split. */
  backgroundJobPoolSize: 5,
  /** Computed below; kept as a field so `createDb` reads one name rather than calling a function. */
  get defaultMaxConnections(): number {
    return requestPoolSizePerInstance();
  },
  /**
   * The test pool: small and short-lived. Every test file calls `createTestDb()` and opens
   * its own `postgres-js` pool that nothing previously closed; at ~40 files that's enough
   * simultaneous connections against the tmpfs-backed `postgres-test` container to cause
   * contention and transient timeouts under a full-suite run. A small max plus a short idle
   * timeout keeps each file's footprint bounded even before `createTestDb`'s own
   * `afterAll(() => db.$client.end())` releases it for good.
   */
  testMaxConnections: 3,
  testIdleTimeoutSeconds: 5,
} as const;

/** The formula in this module's docblock, executable. */
export function requestPoolSizePerInstance(): number {
  const available =
    DB_POOL_CONFIG.postgresMaxConnections -
    DB_POOL_CONFIG.reservedSuperuserConnections -
    DB_POOL_CONFIG.backgroundJobPoolSize;
  return Math.floor(available / DB_POOL_CONFIG.expectedMaxInstances);
}
