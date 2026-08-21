import { describe, expect, it } from "vitest";
import { TRADE_CONFIG } from "./config";

describe("TRADE_CONFIG", () => {
  it("matches ADVISOR_CONFIG.maxPlayersPerSide on purpose — a proposal the advisor cannot assess is one a manager accepts blind", () => {
    expect(TRADE_CONFIG.maxAssetsPerSide).toBe(5);
  });

  it("keeps every numeric tunable positive and finite", () => {
    expect(TRADE_CONFIG.proposalTtlHours).toBeGreaterThan(0);
    expect(TRADE_CONFIG.maxAssetsPerSide).toBeGreaterThan(0);
    expect(TRADE_CONFIG.maxOpenProposalsPerTeam).toBeGreaterThan(0);
    expect(TRADE_CONFIG.noteMaxLength).toBeGreaterThan(0);
    expect(TRADE_CONFIG.rateLimit.maxRequests).toBeGreaterThan(0);
    expect(TRADE_CONFIG.rateLimit.windowMs).toBeGreaterThan(0);
  });

  it("carries no integrity threshold — that is INTEGRITY_CONFIG.trade's job, not this one's", () => {
    expect(TRADE_CONFIG).not.toHaveProperty("fairnessFlagThreshold");
    expect(TRADE_CONFIG).not.toHaveProperty("autoHoldThreshold");
  });
});
