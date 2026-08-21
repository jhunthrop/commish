import { describe, expect, it } from "vitest";
import { TRADE_CONFIG } from "@/trades/config";
import { proposeTradeSchema, tradeDecisionSchema } from "./trade-schemas";

function validBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    counterpartyTeamId: "team_b",
    weekNumber: 3,
    proposerAssets: [{ kind: "player", playerId: "p_rb1" }],
    counterpartyAssets: [{ kind: "player", playerId: "p_wr1" }],
    note: null,
    ...overrides,
  };
}

describe("proposeTradeSchema", () => {
  it("accepts a well-formed offer", () => {
    const result = proposeTradeSchema.safeParse(validBody());
    expect(result.success).toBe(true);
  });

  it("has no field a body could spoof a proposing team through", () => {
    expect(Object.keys(proposeTradeSchema.shape)).not.toContain("proposerTeamId");
  });

  it("refuses a missing counterpartyTeamId", () => {
    const result = proposeTradeSchema.safeParse(validBody({ counterpartyTeamId: "" }));
    expect(result.success).toBe(false);
  });

  it("refuses a non-positive week", () => {
    expect(proposeTradeSchema.safeParse(validBody({ weekNumber: 0 })).success).toBe(false);
    expect(proposeTradeSchema.safeParse(validBody({ weekNumber: -1 })).success).toBe(false);
    expect(proposeTradeSchema.safeParse(validBody({ weekNumber: 1.5 })).success).toBe(false);
  });

  it("refuses an empty proposer side", () => {
    expect(proposeTradeSchema.safeParse(validBody({ proposerAssets: [] })).success).toBe(false);
  });

  it("refuses an empty counterparty side", () => {
    expect(proposeTradeSchema.safeParse(validBody({ counterpartyAssets: [] })).success).toBe(false);
  });

  it("refuses a side past TRADE_CONFIG.maxAssetsPerSide", () => {
    const tooMany = Array.from({ length: TRADE_CONFIG.maxAssetsPerSide + 1 }, (_, i) => ({ kind: "player", playerId: `p_${i}` }));
    expect(proposeTradeSchema.safeParse(validBody({ proposerAssets: tooMany })).success).toBe(false);
  });

  it("accepts exactly TRADE_CONFIG.maxAssetsPerSide assets", () => {
    const atCap = Array.from({ length: TRADE_CONFIG.maxAssetsPerSide }, (_, i) => ({ kind: "player", playerId: `p_${i}` }));
    expect(proposeTradeSchema.safeParse(validBody({ proposerAssets: atCap })).success).toBe(true);
  });

  it("refuses an asset kind outside the closed vocabulary", () => {
    const result = proposeTradeSchema.safeParse(validBody({ proposerAssets: [{ kind: "pick", playerId: "p_1" }] }));
    expect(result.success).toBe(false);
  });

  it("refuses an asset with no playerId", () => {
    const result = proposeTradeSchema.safeParse(validBody({ proposerAssets: [{ kind: "player", playerId: "" }] }));
    expect(result.success).toBe(false);
  });

  it("refuses a note past TRADE_CONFIG.noteMaxLength", () => {
    const result = proposeTradeSchema.safeParse(validBody({ note: "x".repeat(TRADE_CONFIG.noteMaxLength + 1) }));
    expect(result.success).toBe(false);
  });

  it("accepts a note right at the cap", () => {
    const result = proposeTradeSchema.safeParse(validBody({ note: "x".repeat(TRADE_CONFIG.noteMaxLength) }));
    expect(result.success).toBe(true);
  });

  it("keeps a real note as written", () => {
    const result = proposeTradeSchema.safeParse(validBody({ note: "one more year" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBe("one more year");
  });

  it("collapses a whitespace-only note to null", () => {
    const result = proposeTradeSchema.safeParse(validBody({ note: "   " }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBeNull();
  });

  it("requires the note field rather than defaulting a missing one", () => {
    const withoutNote = {
      counterpartyTeamId: "team_b",
      weekNumber: 3,
      proposerAssets: [{ kind: "player", playerId: "p_rb1" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_wr1" }],
    };
    expect(proposeTradeSchema.safeParse(withoutNote).success).toBe(false);
  });
});

describe("tradeDecisionSchema", () => {
  it("accepts accept, reject and withdraw", () => {
    for (const action of ["accept", "reject", "withdraw"]) {
      expect(tradeDecisionSchema.safeParse({ action }).success).toBe(true);
    }
  });

  it("refuses anything outside that closed set", () => {
    expect(tradeDecisionSchema.safeParse({ action: "counter" }).success).toBe(false);
    expect(tradeDecisionSchema.safeParse({}).success).toBe(false);
  });
});
