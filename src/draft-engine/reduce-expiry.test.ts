import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction, TimerExpireAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { isComplete, remainingBudget, teamOnClock } from "./selectors";

const SPRINT_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];

const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
];

const T = "2026-09-01T00:00:00.000Z";
const EXPIRE: TimerExpireAction = { v: 1, type: "TIMER_EXPIRE", timestamp: "2026-09-01T01:00:00.000Z" };
const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: T, draftOrder: ["t1", "t2"], pool: POOL };

function apply(state: DraftState, action: Parameters<typeof reduceDraft>[1]): DraftState {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

const snakeConfig: DraftConfig = {
  draftId: "d_s", leagueId: "l1", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null, slotConfig: SPRINT_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
};
const auctionConfig: DraftConfig = { ...snakeConfig, draftId: "d_a", format: "auction", auctionBudget: 10 };

describe("TIMER_EXPIRE (snake)", () => {
  it("autopicks the best available player the team can roster and hands over the turn", () => {
    const state = apply(apply(initialDraftState(snakeConfig), START), EXPIRE);
    expect(state.picks).toEqual([
      { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB", price: null, timestamp: EXPIRE.timestamp, auto: true },
    ]);
    expect(teamOnClock(state)).toBe("t2");
  });

  it("skips a player the team can't roster and takes the next one it can", () => {
    // t1 takes qb1 by hand; on expiry t1's next autopick must be an RB, not qb2.
    let state = apply(initialDraftState(snakeConfig), START);
    state = apply(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" });
    state = apply(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t2", playerId: "qb2" });
    state = apply(state, EXPIRE); // round 2 reverses: t2 picks first
    expect(state.picks[2]?.teamId).toBe("t2");
    expect(state.picks[2]?.playerId).toBe("rb1");
  });

  it("completes the draft when the final autopick lands", () => {
    let state = apply(initialDraftState(snakeConfig), START);
    for (let i = 0; i < 4; i++) state = apply(state, EXPIRE);
    expect(isComplete(state)).toBe(true);
    expect(state.picks).toHaveLength(4);
    expect(state.picks.every((p) => p.auto)).toBe(true);
  });

  it("rejects an expiry before the draft has started", () => {
    expect(reduceDraft(initialDraftState(snakeConfig), EXPIRE)).toEqual({ ok: false, reason: "This draft hasn't started yet." });
  });

  it("rejects an expiry when no eligible player is available to auto-pick", () => {
    // SPRINT_SLOTS here has no BENCH, so a kicker fits nowhere in this league at all.
    const state = apply(initialDraftState(snakeConfig), { ...START, pool: [{ playerId: "k1", position: "K" }] });
    expect(reduceDraft(state, EXPIRE)).toEqual({ ok: false, reason: "No eligible player is available to auto-pick." });
  });
});

describe("TIMER_EXPIRE (auction)", () => {
  const started = () => apply(initialDraftState(auctionConfig), START);

  it("awards an open lot to the high bidder at the high bid and rotates the nomination", () => {
    let state = apply(started(), { v: 1, type: "NOMINATE", timestamp: T, teamId: "t1", playerId: "qb1", openingBid: 3 });
    state = apply(state, { v: 1, type: "BID", timestamp: T, teamId: "t2", amount: 4 });
    state = apply(state, EXPIRE);
    expect(state.picks).toEqual([
      { pickNumber: 1, round: 1, teamId: "t2", playerId: "qb1", slot: "QB", price: 4, timestamp: EXPIRE.timestamp, auto: false },
    ]);
    expect(remainingBudget(state, "t2")).toBe(6);
    expect(remainingBudget(state, "t1")).toBe(10);
    expect(state.pickNumber).toBe(2);
    expect(state.auction).toEqual({ nominatingTeamId: "t2", lot: null });
  });

  it("awards an unchallenged lot to the nominator at their opening bid", () => {
    let state = apply(started(), { v: 1, type: "NOMINATE", timestamp: T, teamId: "t1", playerId: "qb1", openingBid: 3 });
    state = apply(state, EXPIRE);
    expect(state.picks[0]?.teamId).toBe("t1");
    expect(state.picks[0]?.price).toBe(3);
    expect(state.picks[0]?.auto).toBe(false);
  });

  it("auto-nominates the nominating team's best available player at the minimum bid when they stall", () => {
    const state = apply(started(), EXPIRE);
    expect(state.picks).toEqual([]);
    expect(state.auction?.lot).toEqual({
      playerId: "qb1", highBid: 1, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: true,
    });
    expect(state.turnStartedAt).toBe(EXPIRE.timestamp);
  });

  it("marks a pick auto when an auto-nominated lot goes unchallenged", () => {
    const state = apply(apply(started(), EXPIRE), EXPIRE);
    expect(state.picks[0]).toMatchObject({ teamId: "t1", playerId: "qb1", price: 1, auto: true });
  });

  it("runs a whole auction to completion on the clock alone", () => {
    let state = started();
    for (let i = 0; i < 8; i++) state = apply(state, EXPIRE);
    expect(isComplete(state)).toBe(true);
    expect(state.picks).toHaveLength(4);
    expect(state.auction?.nominatingTeamId).toBeNull();
    expect(state.auction?.lot).toBeNull();
  });

  it("rejects an auto-nomination when the stalled team has no eligible player left at all", () => {
    // Only a QB slot exists — no BENCH — so once the pool's lone QB is gone, the
    // remaining WR fits nowhere and the next team's stall can't even auto-nominate.
    const qbOnlyConfig: DraftConfig = {
      ...auctionConfig, slotConfig: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }],
    };
    const qbOnlyPool: readonly DraftPoolEntry[] = [{ playerId: "qb1", position: "QB" }, { playerId: "wr1", position: "WR" }];
    let state = apply(initialDraftState(qbOnlyConfig), { ...START, pool: qbOnlyPool });
    state = apply(state, EXPIRE); // t1 auto-nominates qb1
    state = apply(state, EXPIRE); // t1 wins qb1 uncontested; t2 is up next
    expect(reduceDraft(state, EXPIRE)).toEqual({ ok: false, reason: "No eligible player is available to auto-pick." });
  });
});
