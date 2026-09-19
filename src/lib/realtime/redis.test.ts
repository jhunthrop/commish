import { describe, expect, it } from "vitest";
import { REALTIME_CONFIG } from "./config";
import { redisOptionsFor } from "./redis";

describe("redisOptionsFor (item 4: finite retries, a fail-fast publish)", () => {
  it("a publishing connection retries a bounded number of times and cuts every command off", () => {
    const options = redisOptionsFor("publish");
    expect(options.maxRetriesPerRequest).toBe(REALTIME_CONFIG.maxRetriesPerRequest);
    expect(options.maxRetriesPerRequest).not.toBeNull();
    expect(options.commandTimeout).toBe(REALTIME_CONFIG.commandTimeoutMs);
    expect(options.connectTimeout).toBe(REALTIME_CONFIG.connectTimeoutMs);
  });

  it("a subscriber keeps the retry bound but no command timeout: its blocking read waits blockMs by design", () => {
    const options = redisOptionsFor("subscribe");
    expect(options.maxRetriesPerRequest).toBe(REALTIME_CONFIG.maxRetriesPerRequest);
    expect(options.commandTimeout).toBeUndefined();
    // A command timeout under the block window would cut every quiet read short.
    expect(REALTIME_CONFIG.commandTimeoutMs).toBeLessThan(REALTIME_CONFIG.blockMs);
  });

  it("the sweep's attempt can never be held by one publish: a few retried commands stay far under 45 s", () => {
    const worst = (REALTIME_CONFIG.maxRetriesPerRequest + 1) * REALTIME_CONFIG.commandTimeoutMs + REALTIME_CONFIG.connectTimeoutMs;
    expect(worst).toBeLessThan(15_000);
  });
});
