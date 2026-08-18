import { describe, it, expect } from "vitest";
import type { BidAction, DraftPoolEntry, NominateAction, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { maxBidFor, minBidFor, remainingBudget, teamOnClock } from "./selectors";
import { expireAt, submitCommand } from "./test-support";

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
const START: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, timestamp: T, draftOrder: ["t1", "t2"], pool: POOL };

function apply(state: DraftState, action: Parameters<typeof submitCommand>[1]): DraftState {
  const result = submitCommand(state, action);
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
    expect(state.auction).toEqual({ nominatingTeamId: "t1", lot: null, minBid: 1 });
    expect(teamOnClock(state)).toBe("t1");
    // $10 with 3 spots to fill: $2 is reserved for the other two spots.
    expect(maxBidFor(state, "t1")).toBe(8);
  });

  it("rejects a budget that can't cover $1 per roster spot", () => {
    const broke: DraftConfig = { ...CONFIG, auctionBudget: 2 };
    expect(submitCommand(initialDraftState(broke), START)).toEqual({
      ok: false,
      reason: "An auction budget must be at least $1 for every roster spot.",
    });
  });
});

describe("NOMINATE", () => {
  it("opens a lot at the nominator's own opening bid and restarts the clock", () => {
    const state = apply(started(), nominate("t1", "qb1", 3, "2026-09-01T00:05:00.000Z"));
    expect(state.auction).toEqual({
      nominatingTeamId: "t1", minBid: 1,
      lot: { playerId: "qb1", highBid: 3, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: false },
    });
    expect(state.turnStartedAt).toBe("2026-09-01T00:05:00.000Z");
    // Nothing is spent until the lot is awarded.
    expect(remainingBudget(state, "t1")).toBe(10);
  });

  it("rejects a nomination from a team that isn't up", () => {
    expect(submitCommand(started(), nominate("t2", "qb1", 1))).toEqual({ ok: false, reason: "It's not your turn to nominate." });
  });

  it("rejects a nomination while a player is already up for bid", () => {
    const state = apply(started(), nominate("t1", "qb1", 1));
    expect(submitCommand(state, nominate("t1", "rb1", 1))).toEqual({ ok: false, reason: "There's already a player up for bid." });
  });

  it("rejects a player who isn't in the pool", () => {
    expect(submitCommand(started(), nominate("t1", "ghost", 1))).toEqual({ ok: false, reason: "That player isn't in this draft's player pool." });
  });

  it("rejects an opening bid below the minimum", () => {
    expect(submitCommand(started(), nominate("t1", "qb1", 0))).toEqual({ ok: false, reason: "The opening bid must be at least $1." });
  });

  it("rejects a nomination for an already-drafted player", () => {
    let state = apply(started(), nominate("t1", "qb1", 1));
    state = apply(state, expireAt(state)); // t1 wins qb1 uncontested; t2 is up next
    expect(submitCommand(state, nominate("t2", "qb1", 1))).toEqual({ ok: false, reason: "That player has already been drafted." });
  });

  it("rejects a nomination for a position no slot in this league accepts", () => {
    // No slot here — not even BENCH — takes a WR, so wr1 has nowhere to go regardless of budget.
    const noWrSlots: readonly RosterSlotConfig[] = [
      { slot: "QB", count: 1, eligiblePositions: ["QB"] },
      { slot: "RB", count: 1, eligiblePositions: ["RB"] },
    ];
    const config: DraftConfig = { ...CONFIG, slotConfig: noWrSlots };
    const state = apply(initialDraftState(config), START);
    expect(submitCommand(state, nominate("t1", "wr1", 1))).toEqual({ ok: false, reason: "No roster slot in this league accepts a WR." });
  });

  it("rejects an opening bid above the nominator's maximum", () => {
    expect(submitCommand(started(), nominate("t1", "qb1", 9))).toEqual({
      ok: false,
      reason: "You can only bid up to $8 — you need $1 for each of your remaining roster spots.",
    });
  });

  it("accepts an opening bid exactly at the nominator's maximum", () => {
    const state = apply(started(), nominate("t1", "qb1", 8));
    expect(state.auction?.lot).toMatchObject({ highBid: 8, highBidTeamId: "t1" });
  });

  it("rejects a pick in an auction draft", () => {
    expect(submitCommand(started(), { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" })).toEqual({
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
    expect(submitCommand(withLot(), bid("t2", 3))).toEqual({ ok: false, reason: "Your bid must be at least $4." });
  });

  it("rejects a team outbidding itself", () => {
    expect(submitCommand(withLot(), bid("t1", 5))).toEqual({ ok: false, reason: "You can't outbid yourself." });
  });

  it("rejects a bid when nothing is up for auction", () => {
    expect(submitCommand(started(), bid("t2", 5))).toEqual({ ok: false, reason: "There's no player up for bid right now." });
  });

  it("rejects a bid above the bidder's maximum", () => {
    expect(submitCommand(withLot(), bid("t2", 9))).toEqual({
      ok: false,
      reason: "You can only bid up to $8 — you need $1 for each of your remaining roster spots.",
    });
  });

  it("accepts a bid exactly at the bidder's maximum", () => {
    const state = apply(withLot(), bid("t2", 8));
    expect(state.auction?.lot).toMatchObject({ highBid: 8, highBidTeamId: "t2" });
  });

  it("rejects a bid in a snake draft", () => {
    const snake: DraftConfig = { ...CONFIG, format: "snake", auctionBudget: null };
    const state = apply(initialDraftState(snake), START);
    expect(submitCommand(state, bid("t2", 5))).toEqual({ ok: false, reason: "This is a snake draft — there's nothing to bid on." });
  });
});

describe("nomination rotation across three teams", () => {
  // One universal slot each, so a single won lot fills a roster completely and makes
  // that team ineligible to nominate or bid again.
  const THREE_TEAM_SLOTS: readonly RosterSlotConfig[] = [
    { slot: "BENCH", count: 1, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
  ];
  const THREE_TEAM_POOL: readonly DraftPoolEntry[] = [
    { playerId: "p1", position: "QB" },
    { playerId: "p2", position: "RB" },
    { playerId: "p3", position: "WR" },
  ];
  const threeTeamConfig: DraftConfig = {
    draftId: "draft_3", leagueId: "league_1", format: "auction", kickoffAt: "2026-09-10T17:00:00.000Z",
    auctionBudget: 5, slotConfig: THREE_TEAM_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };
  const threeTeamStart: StartDraftAction = {
    v: 1, type: "START_DRAFT", minBid: 1, timestamp: T, draftOrder: ["t1", "t2", "t3"], pool: THREE_TEAM_POOL,
  };

  it("skips a team whose roster is already full to reach a non-adjacent open one", () => {
    let state = apply(initialDraftState(threeTeamConfig), threeTeamStart);
    // t1 nominates p1, but t2 outbids and wins it — t2's one slot fills even though it
    // wasn't t2's own nomination turn.
    state = apply(state, nominate("t1", "p1", 1));
    state = apply(state, bid("t2", 2));
    state = apply(state, expireAt(state));
    expect(state.rosters.t2).toHaveLength(1);
    // Rotation resumes after the nominator (t1): t2 is full and gets skipped, landing on
    // t3 — which is not adjacent to t1 in the original draft order.
    expect(state.auction).toEqual({ nominatingTeamId: "t3", lot: null, minBid: 1 });
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

  it("returns 0 for a team whose roster is already completely full", () => {
    const state = started();
    const fullRoster = [
      { slot: "QB" as const, slotIndex: 0, playerId: "qb1" },
      { slot: "RB" as const, slotIndex: 0, playerId: "rb1" },
      { slot: "BENCH" as const, slotIndex: 0, playerId: "wr1" },
    ];
    const fullState = { ...state, rosters: { ...state.rosters, t1: fullRoster } };
    expect(maxBidFor(fullState, "t1")).toBe(0);
  });

  it("puts nobody on the clock while a lot is live — during bidding the clock belongs to everyone", () => {
    expect(teamOnClock(apply(started(), nominate("t1", "qb1", 3)))).toBeNull();
  });
});
