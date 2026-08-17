import { describe, it, expect } from "vitest";
import type { BidAction, DraftPoolEntry, NominateAction, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { maxBidFor, minBidFor, remainingBudget, teamOnClock } from "./selectors";

const SPRINT_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "BENCH", count: 1, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
  { playerId: "wr1", position: "WR" },
  { playerId: "wr2", position: "WR" },
];

const CONFIG: DraftConfig = {
  draftId: "draft_a",
  leagueId: "league_1",
  format: "auction",
  kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: 10,
  slotConfig: SPRINT_SLOTS,
  clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

const T = "2026-09-01T00:00:00.000Z";
const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: T, draftOrder: ["t1", "t2"], pool: POOL };

function apply(state: DraftState, action: Parameters<typeof reduceDraft>[1]): DraftState {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

function started(): DraftState {
  return apply(initialDraftState(CONFIG), START);
}

const nominate = (teamId: string, playerId: string, openingBid: number, timestamp = T): NominateAction => ({
  v: 1, type: "NOMINATE", timestamp, teamId, playerId, openingBid,
});
const bid = (teamId: string, amount: number, timestamp = T): BidAction => ({ v: 1, type: "BID", timestamp, teamId, amount });

describe("START_DRAFT (auction)", () => {
  it("seeds every team's budget and puts team one up to nominate", () => {
    const state = started();
    expect(state.budgets).toEqual({ t1: 10, t2: 10 });
    expect(state.auction).toEqual({ nominatingTeamId: "t1", lot: null });
    expect(teamOnClock(state)).toBe("t1");
    // $10 with 3 spots to fill: $2 is reserved for the other two spots.
    expect(maxBidFor(state, "t1")).toBe(8);
  });

  it("rejects a budget that can't cover $1 per roster spot", () => {
    const broke: DraftConfig = { ...CONFIG, auctionBudget: 2 };
    expect(reduceDraft(initialDraftState(broke), START)).toEqual({
      ok: false,
      reason: "An auction budget must be at least $1 for every roster spot.",
    });
  });
});

describe("NOMINATE", () => {
  it("opens a lot at the nominator's own opening bid and restarts the clock", () => {
    const state = apply(started(), nominate("t1", "qb1", 3, "2026-09-01T00:05:00.000Z"));
    expect(state.auction).toEqual({
      nominatingTeamId: "t1",
      lot: { playerId: "qb1", highBid: 3, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: false },
    });
    expect(state.turnStartedAt).toBe("2026-09-01T00:05:00.000Z");
    // Nothing is spent until the lot is awarded.
    expect(remainingBudget(state, "t1")).toBe(10);
  });

  it("rejects a nomination from a team that isn't up", () => {
    expect(reduceDraft(started(), nominate("t2", "qb1", 1))).toEqual({ ok: false, reason: "It's not your turn to nominate." });
  });

  it("rejects a nomination while a player is already up for bid", () => {
    const state = apply(started(), nominate("t1", "qb1", 1));
    expect(reduceDraft(state, nominate("t1", "rb1", 1))).toEqual({ ok: false, reason: "There's already a player up for bid." });
  });

  it("rejects a player who isn't in the pool", () => {
    expect(reduceDraft(started(), nominate("t1", "ghost", 1))).toEqual({ ok: false, reason: "That player isn't in this draft's player pool." });
  });

  it("rejects an opening bid above the nominator's maximum", () => {
    expect(reduceDraft(started(), nominate("t1", "qb1", 9))).toEqual({
      ok: false,
      reason: "You can only bid up to $8 — you need $1 for each of your remaining roster spots.",
    });
  });

  it("rejects a pick in an auction draft", () => {
    expect(reduceDraft(started(), { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" })).toEqual({
      ok: false,
      reason: "This is an auction draft — nominate a player instead of picking.",
    });
  });
});

describe("BID", () => {
  const withLot = () => apply(started(), nominate("t1", "qb1", 3));

  it("raises the lot, records the new high bidder and restarts the bid window", () => {
    const state = apply(withLot(), bid("t2", 4, "2026-09-01T00:06:00.000Z"));
    expect(state.auction?.lot).toEqual({
      playerId: "qb1", highBid: 4, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false,
    });
    expect(state.turnStartedAt).toBe("2026-09-01T00:06:00.000Z");
  });

  it("rejects a bid that doesn't clear the increment", () => {
    expect(reduceDraft(withLot(), bid("t2", 3))).toEqual({ ok: false, reason: "Your bid must be at least $4." });
  });

  it("rejects a team outbidding itself", () => {
    expect(reduceDraft(withLot(), bid("t1", 5))).toEqual({ ok: false, reason: "You can't outbid yourself." });
  });

  it("rejects a bid when nothing is up for auction", () => {
    expect(reduceDraft(started(), bid("t2", 5))).toEqual({ ok: false, reason: "There's no player up for bid right now." });
  });

  it("rejects a bid above the bidder's maximum", () => {
    expect(reduceDraft(withLot(), bid("t2", 9))).toEqual({
      ok: false,
      reason: "You can only bid up to $8 — you need $1 for each of your remaining roster spots.",
    });
  });

  it("rejects a bid in a snake draft", () => {
    const snake: DraftConfig = { ...CONFIG, format: "snake", auctionBudget: null };
    const state = apply(initialDraftState(snake), START);
    expect(reduceDraft(state, bid("t2", 5))).toEqual({ ok: false, reason: "This is a snake draft — there's nothing to bid on." });
  });
});

describe("auction selectors", () => {
  it("reports the minimum legal bid before and during a lot, and $1 in a snake draft", () => {
    expect(minBidFor(started())).toBe(1);
    expect(minBidFor(apply(started(), nominate("t1", "qb1", 3)))).toBe(4);
    const snake: DraftConfig = { ...CONFIG, format: "snake", auctionBudget: null };
    expect(minBidFor(apply(initialDraftState(snake), START))).toBe(1);
  });

  it("reports no budget and no bidding room for a team it has never seen", () => {
    expect(remainingBudget(started(), "nobody")).toBe(0);
    expect(maxBidFor(started(), "nobody")).toBe(0);
  });

  it("puts nobody on the clock while a lot is live — during bidding the clock belongs to everyone", () => {
    expect(teamOnClock(apply(started(), nominate("t1", "qb1", 3)))).toBeNull();
  });
});
