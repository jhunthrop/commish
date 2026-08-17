import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction, TimerExpireAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { isComplete, currentDeadline, remainingBudget, teamOnClock } from "./selectors";
import { expireAt } from "./test-support";

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
// A stale constant, used only where the exact timestamp doesn't matter (e.g. the
// draft-hasn't-started rejection, which is decided before any deadline check runs).
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

describe("TIMER_EXPIRE — the clock must actually have run out (R-B4)", () => {
  it("rejects a snake expiry one second before the deadline, leaving state unchanged", () => {
    const started = apply(initialDraftState(snakeConfig), START);
    const deadline = currentDeadline(started)!;
    const early = new Date(Date.parse(deadline) - 1_000).toISOString();

    expect(reduceDraft(started, { v: 1, type: "TIMER_EXPIRE", timestamp: early })).toEqual({
      ok: false,
      reason: "The clock hasn't run out yet.",
    });
    // The rejected call must not have mutated the state we hold a reference to.
    expect(started.picks).toHaveLength(0);
    expect(started.turnStartedAt).toBe(T);
  });

  it("accepts a snake expiry exactly at the deadline", () => {
    const started = apply(initialDraftState(snakeConfig), START);
    const result = reduceDraft(started, expireAt(started));
    expect(result.ok).toBe(true);
  });

  it("rejects an auction expiry before the bid window elapses, and awards once it does", () => {
    let state = apply(initialDraftState(auctionConfig), START);
    state = apply(state, { v: 1, type: "NOMINATE", timestamp: T, teamId: "t1", playerId: "qb1", openingBid: 3 });
    state = apply(state, { v: 1, type: "BID", timestamp: T, teamId: "t2", amount: 4 });
    const deadline = currentDeadline(state)!;
    const early = new Date(Date.parse(deadline) - 1_000).toISOString();

    const rejected = reduceDraft(state, { v: 1, type: "TIMER_EXPIRE", timestamp: early });
    expect(rejected).toEqual({ ok: false, reason: "The clock hasn't run out yet." });
    expect(state.auction?.lot?.highBidTeamId).toBe("t2"); // untouched by the rejected call

    const awarded = apply(state, { v: 1, type: "TIMER_EXPIRE", timestamp: deadline });
    expect(awarded.picks[0]).toMatchObject({ teamId: "t2", playerId: "qb1", price: 4 });
  });

  it("rejects a stale TIMER_EXPIRE whose timestamp predates a pick that already advanced the turn", () => {
    // The ticker's check-then-act race: it reads state and computes a deadline, but before
    // it submits TIMER_EXPIRE, the on-clock team makes a legitimate (if late) pick. The
    // ticker's now-stale timestamp must not be allowed to autopick for whoever is next.
    const started = apply(initialDraftState(snakeConfig), START); // t1 on the clock
    const t1Deadline = currentDeadline(started)!; // T0 — what the ticker computed
    const t1PickTime = new Date(Date.parse(t1Deadline) + 1_000).toISOString(); // T1 > T0

    const afterPick = apply(started, { v: 1, type: "MAKE_PICK", timestamp: t1PickTime, teamId: "t1", playerId: "qb1" });
    expect(teamOnClock(afterPick)).toBe("t2");
    expect(afterPick.turnStartedAt).toBe(t1PickTime);

    const staleExpire: TimerExpireAction = { v: 1, type: "TIMER_EXPIRE", timestamp: t1Deadline };
    expect(reduceDraft(afterPick, staleExpire)).toEqual({ ok: false, reason: "The clock hasn't run out yet." });
    expect(teamOnClock(afterPick)).toBe("t2"); // still t2's turn — unaffected by the rejected call
  });
});

describe("TIMER_EXPIRE (snake)", () => {
  it("autopicks the best available player the team can roster and hands over the turn", () => {
    const started = apply(initialDraftState(snakeConfig), START);
    const expire = expireAt(started);
    const state = apply(started, expire);
    expect(state.picks).toEqual([
      { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB", price: null, timestamp: expire.timestamp, auto: true },
    ]);
    expect(teamOnClock(state)).toBe("t2");
  });

  it("skips a player the team can't roster and takes the next one it can", () => {
    // t1 takes qb1 by hand; on expiry t1's next autopick must be an RB, not qb2.
    let state = apply(initialDraftState(snakeConfig), START);
    state = apply(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" });
    state = apply(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t2", playerId: "qb2" });
    state = apply(state, expireAt(state)); // round 2 reverses: t2 picks first
    expect(state.picks[2]?.teamId).toBe("t2");
    expect(state.picks[2]?.playerId).toBe("rb1");
  });

  it("completes the draft when the final autopick lands", () => {
    let state = apply(initialDraftState(snakeConfig), START);
    for (let i = 0; i < 4; i++) state = apply(state, expireAt(state));
    expect(isComplete(state)).toBe(true);
    expect(state.picks).toHaveLength(4);
    expect(state.picks.every((p) => p.auto)).toBe(true);
  });

  it("rejects an expiry before the draft has started", () => {
    expect(reduceDraft(initialDraftState(snakeConfig), EXPIRE)).toEqual({ ok: false, reason: "This draft hasn't started yet." });
  });

  it("rejects an expiry when no eligible player is available to auto-pick", () => {
    // SPRINT_SLOTS here has no BENCH, so a kicker fits nowhere in this league at all. Four
    // kickers (not one) so the pool still clears the "enough players to fill every roster"
    // count check at START_DRAFT — this test is about eligibility, not pool size.
    const kickers: readonly DraftPoolEntry[] = [
      { playerId: "k1", position: "K" },
      { playerId: "k2", position: "K" },
      { playerId: "k3", position: "K" },
      { playerId: "k4", position: "K" },
    ];
    const state = apply(initialDraftState(snakeConfig), { ...START, pool: kickers });
    expect(reduceDraft(state, expireAt(state))).toEqual({ ok: false, reason: "No eligible player is available to auto-pick." });
  });
});

describe("TIMER_EXPIRE (auction)", () => {
  const started = () => apply(initialDraftState(auctionConfig), START);

  it("awards an open lot to the high bidder at the high bid and rotates the nomination", () => {
    let state = apply(started(), { v: 1, type: "NOMINATE", timestamp: T, teamId: "t1", playerId: "qb1", openingBid: 3 });
    state = apply(state, { v: 1, type: "BID", timestamp: T, teamId: "t2", amount: 4 });
    const expire = expireAt(state);
    state = apply(state, expire);
    expect(state.picks).toEqual([
      { pickNumber: 1, round: 1, teamId: "t2", playerId: "qb1", slot: "QB", price: 4, timestamp: expire.timestamp, auto: false },
    ]);
    expect(remainingBudget(state, "t2")).toBe(6);
    expect(remainingBudget(state, "t1")).toBe(10);
    expect(state.pickNumber).toBe(2);
    expect(state.auction).toEqual({ nominatingTeamId: "t2", lot: null });
  });

  it("awards an unchallenged lot to the nominator at their opening bid", () => {
    let state = apply(started(), { v: 1, type: "NOMINATE", timestamp: T, teamId: "t1", playerId: "qb1", openingBid: 3 });
    state = apply(state, expireAt(state));
    expect(state.picks[0]?.teamId).toBe("t1");
    expect(state.picks[0]?.price).toBe(3);
    expect(state.picks[0]?.auto).toBe(false);
  });

  it("auto-nominates the nominating team's best available player at the minimum bid when they stall", () => {
    const s0 = started();
    const expire = expireAt(s0);
    const state = apply(s0, expire);
    expect(state.picks).toEqual([]);
    expect(state.auction?.lot).toEqual({
      playerId: "qb1", highBid: 1, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: true,
    });
    expect(state.turnStartedAt).toBe(expire.timestamp);
  });

  it("marks a pick auto when an auto-nominated lot goes unchallenged", () => {
    let state = apply(started(), expireAt(started()));
    state = apply(state, expireAt(state));
    expect(state.picks[0]).toMatchObject({ teamId: "t1", playerId: "qb1", price: 1, auto: true });
  });

  it("runs a whole auction to completion on the clock alone", () => {
    let state = started();
    for (let i = 0; i < 8; i++) state = apply(state, expireAt(state));
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
    state = apply(state, expireAt(state)); // t1 auto-nominates qb1
    state = apply(state, expireAt(state)); // t1 wins qb1 uncontested; t2 is up next
    expect(reduceDraft(state, expireAt(state))).toEqual({ ok: false, reason: "No eligible player is available to auto-pick." });
  });
});
