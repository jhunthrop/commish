import { describe, it, expect } from "vitest";
import type { DraftStateView } from "@/draft-engine";
import { optimisticView } from "./optimistic";

const base: DraftStateView = {
  phase: "in_progress",
  sequence: 4,
  pickNumber: 3,
  onClockTeamId: "t1",
  deadlineAt: "2026-09-01T08:00:00.000Z",
  clockSeconds: 28_800,
  nextTightening: null,
  upcoming: ["t1", "t2"],
  draftId: "d1",
  leagueId: "l1",
  format: "snake",
  slotConfig: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }],
  draftOrder: ["t1", "t2"],
  picks: [],
  rosters: { t1: [] },
  budgets: {},
  auction: null,
  availablePlayerIds: ["qb1", "rb1"],
  minBid: null,
  maxBids: {},
};

const auction: DraftStateView = { ...base, format: "auction", budgets: { t1: 100 }, minBid: 1, maxBids: { t1: 99 }, auction: { nominatingTeamId: "t1", lot: null } };

describe("optimisticView", () => {
  it("does nothing for a spectator with no team", () => {
    expect(optimisticView(base, { type: "MAKE_PICK", playerId: "qb1" }, null)).toEqual({ view: base, pendingPlayerId: null });
  });

  it("removes the player from the pool and marks them pending on a pick — and guesses no roster slot", () => {
    const result = optimisticView(base, { type: "MAKE_PICK", playerId: "qb1" }, "t1");
    expect(result.pendingPlayerId).toBe("qb1");
    expect(result.view.availablePlayerIds).toEqual(["rb1"]);
    expect(result.view.rosters.t1).toEqual([]);
    expect(result.view.picks).toEqual([]);
  });

  it("shows the nomination as an open lot at the opening bid", () => {
    const result = optimisticView(auction, { type: "NOMINATE", playerId: "qb1", openingBid: 5 }, "t1");
    expect(result.pendingPlayerId).toBe("qb1");
    expect(result.view.auction).toEqual({
      nominatingTeamId: "t1",
      lot: { playerId: "qb1", highBid: 5, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: false },
    });
  });

  it("leaves a nomination on a non-auction view alone", () => {
    const result = optimisticView(base, { type: "NOMINATE", playerId: "qb1", openingBid: 5 }, "t1");
    expect(result.view).toBe(base);
    expect(result.pendingPlayerId).toBe("qb1");
  });

  it("shows my bid as the high bid immediately", () => {
    const withLot: DraftStateView = { ...auction, auction: { nominatingTeamId: "t2", lot: { playerId: "qb1", highBid: 5, highBidTeamId: "t2", nominatedByTeamId: "t2", autoNominated: false } } };
    const result = optimisticView(withLot, { type: "BID", amount: 6 }, "t1");
    expect(result.view.auction?.lot).toMatchObject({ highBid: 6, highBidTeamId: "t1" });
    expect(result.pendingPlayerId).toBe("qb1");
  });

  it("does nothing for a bid with no open lot, in either format", () => {
    expect(optimisticView(auction, { type: "BID", amount: 6 }, "t1")).toEqual({ view: auction, pendingPlayerId: null });
    expect(optimisticView(base, { type: "BID", amount: 6 }, "t1")).toEqual({ view: base, pendingPlayerId: null });
  });

  it("never speculates a new minBid — that stays the engine's number until the server answers", () => {
    const result = optimisticView(auction, { type: "NOMINATE", playerId: "qb1", openingBid: 5 }, "t1");
    expect(result.view.minBid).toBe(auction.minBid);
  });
});
