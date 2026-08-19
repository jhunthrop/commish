import { describe, expect, it } from "vitest";
import { DB_POOL_CONFIG, requestPoolSizePerInstance } from "./config";

describe("connection-pool budget", () => {
  it("pins the shipped configuration's concrete numbers, not just the formula's shape", () => {
    // The two property tests below hold for ANY (postgresMaxConnections, reservedSuperuserConnections,
    // backgroundJobPoolSize, expectedMaxInstances) — including a silent change to
    // postgresMaxConnections that no longer matches the real server. These literals are what
    // actually pins the shipped budget: 100 - 3 - 5 = 92, floor(92 / 4) = 23 per instance,
    // and 23 * 4 + 5 = 97 <= 97 (100 - 3) is the boundary the docblock and the decision doc cite.
    expect(DB_POOL_CONFIG.postgresMaxConnections).toBe(100);
    expect(DB_POOL_CONFIG.reservedSuperuserConnections).toBe(3);
    expect(DB_POOL_CONFIG.backgroundJobPoolSize).toBe(5);
    expect(DB_POOL_CONFIG.expectedMaxInstances).toBe(4);
    expect(requestPoolSizePerInstance()).toBe(23);
    expect(23 * 4 + 5).toBe(97);
    expect(97).toBeLessThanOrEqual(100 - 3);
  });

  it("divides the real connection budget among the instances that will compete for it", () => {
    const { postgresMaxConnections, reservedSuperuserConnections, backgroundJobPoolSize, expectedMaxInstances } = DB_POOL_CONFIG;
    const available = postgresMaxConnections - reservedSuperuserConnections - backgroundJobPoolSize;
    expect(requestPoolSizePerInstance()).toBe(Math.floor(available / expectedMaxInstances));
  });

  it("never lets every instance plus the batch pool exceed what Postgres will actually grant", () => {
    const { postgresMaxConnections, reservedSuperuserConnections, backgroundJobPoolSize, expectedMaxInstances } = DB_POOL_CONFIG;
    const worstCase = requestPoolSizePerInstance() * expectedMaxInstances + backgroundJobPoolSize;
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
