import { describe, expect, it } from "vitest";
import { DB_POOL_CONFIG, requestPoolSizePerInstance } from "./config";

describe("connection-pool budget", () => {
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
