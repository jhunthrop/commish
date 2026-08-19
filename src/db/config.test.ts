import { describe, expect, it } from "vitest";
import { DB_POOL_CONFIG, requestPoolSizePerInstance } from "./config";

describe("connection-pool budget", () => {
  it("pins the shipped configuration's concrete numbers, not just the formula's shape", () => {
    // The two property tests below hold for ANY (postgresMaxConnections, reservedSuperuserConnections,
    // backgroundJobPoolSize, expectedMaxInstances) — including a silent change to
    // postgresMaxConnections that no longer matches the real server. These literals are what
    // actually pins the shipped budget: the background pool is PER INSTANCE (one ingestion worker
    // per Node process), so 100 - 3 - 5 * 4 = 77, floor(77 / 4) = 19 per instance, and
    // 19 * 4 + 5 * 4 = 96 <= 97 (100 - 3) is the boundary the docblock and the decision doc cite.
    expect(DB_POOL_CONFIG.postgresMaxConnections).toBe(100);
    expect(DB_POOL_CONFIG.reservedSuperuserConnections).toBe(3);
    expect(DB_POOL_CONFIG.backgroundJobPoolSize).toBe(5);
    expect(DB_POOL_CONFIG.expectedMaxInstances).toBe(4);
    expect(requestPoolSizePerInstance()).toBe(19);
    expect(19 * 4 + 5 * 4).toBe(96);
    expect(96).toBeLessThanOrEqual(100 - 3);
  });

  it("divides the real connection budget among the instances that will compete for it", () => {
    const { postgresMaxConnections, reservedSuperuserConnections, backgroundJobPoolSize, expectedMaxInstances } = DB_POOL_CONFIG;
    const available = postgresMaxConnections - reservedSuperuserConnections - backgroundJobPoolSize * expectedMaxInstances;
    expect(requestPoolSizePerInstance()).toBe(Math.floor(available / expectedMaxInstances));
  });

  it("never lets every instance plus ITS OWN batch pool exceed what Postgres will actually grant", () => {
    // Every instance runs its own ingestion worker (`src/instrumentation.ts` starts one in every
    // Node process, `src/stats-pipeline/index.ts` gives it its own pool), so the background pool
    // is counted per instance here. Counting it once was the arithmetic error that overshot by 15.
    const { postgresMaxConnections, reservedSuperuserConnections, backgroundJobPoolSize, expectedMaxInstances } = DB_POOL_CONFIG;
    const worstCase = (requestPoolSizePerInstance() + backgroundJobPoolSize) * expectedMaxInstances;
    expect(worstCase).toBeLessThanOrEqual(postgresMaxConnections - reservedSuperuserConnections);
  });

  it("reserves a separate, smaller pool for background jobs so a batch cannot starve requests", () => {
    expect(DB_POOL_CONFIG.backgroundJobPoolSize).toBeGreaterThan(0);
    expect(DB_POOL_CONFIG.backgroundJobPoolSize).toBeLessThan(requestPoolSizePerInstance());
  });

  it("uses the computed budget as the default pool size", () => {
    expect(DB_POOL_CONFIG.defaultMaxConnections).toBe(requestPoolSizePerInstance());
  });
});
