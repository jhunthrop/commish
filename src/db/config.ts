/**
 * Postgres connection-pool tunables. Centralized here so `createDb` and `createTestDb` don't
 * hardcode pool sizing as inline magic numbers.
 */
export const DB_POOL_CONFIG = {
  /** Default pool size for the process-wide connection (app runtime). */
  defaultMaxConnections: 10,
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
