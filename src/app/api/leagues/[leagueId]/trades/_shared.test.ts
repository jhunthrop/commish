import { beforeEach, describe, expect, it } from "vitest";
import { TRADE_CONFIG } from "@/trades/config";
import { resetTradeRateLimit, tradeRateLimited } from "./_shared";

beforeEach(() => {
  resetTradeRateLimit();
});

describe("tradeRateLimited", () => {
  it("lets a caller through under the ceiling", () => {
    expect(tradeRateLimited("u1")).toBeNull();
  });

  it("answers a 429 once one caller crosses TRADE_CONFIG.rateLimit.maxRequests", async () => {
    for (let i = 0; i < TRADE_CONFIG.rateLimit.maxRequests; i += 1) {
      expect(tradeRateLimited("u1")).toBeNull();
    }
    const limited = tradeRateLimited("u1");
    expect(limited).not.toBeNull();
    expect(limited!.status).toBe(429);
    const body = await limited!.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Too many trade actions");
  });

  it("holds each caller to their OWN ceiling, not a shared one", () => {
    for (let i = 0; i < TRADE_CONFIG.rateLimit.maxRequests; i += 1) {
      expect(tradeRateLimited("u1")).toBeNull();
    }
    expect(tradeRateLimited("u1")).not.toBeNull();
    expect(tradeRateLimited("u2")).toBeNull();
  });

  it("resets between tests, so this ceiling never leaks across the suite", () => {
    expect(tradeRateLimited("u1")).toBeNull();
  });
});
