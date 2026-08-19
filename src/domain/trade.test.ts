import { describe, it, expect } from "vitest";
import { isBalancedProposal, type TradeProposal } from "./trade";

const PROPOSAL: TradeProposal = {
  leagueId: "l1",
  weekNumber: 5,
  from: { teamId: "t1", playerIds: ["rb1"] },
  to: { teamId: "t2", playerIds: ["wr1"] },
};

describe("isBalancedProposal", () => {
  it("accepts a proposal where both sides send somebody", () => {
    expect(isBalancedProposal(PROPOSAL)).toBe(true);
  });

  it("rejects a proposal with an empty side — a gift is not a trade to analyze", () => {
    expect(isBalancedProposal({ ...PROPOSAL, to: { teamId: "t2", playerIds: [] } })).toBe(false);
  });

  it("rejects a team trading with itself", () => {
    expect(isBalancedProposal({ ...PROPOSAL, to: { teamId: "t1", playerIds: ["wr1"] } })).toBe(false);
  });
});
