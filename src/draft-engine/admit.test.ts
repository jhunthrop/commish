import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction, TimerExpireAction } from "@research/domain/draft";
import type { RosterSlotConfig } from "@research/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE, DRAFT_QUEUE_CONFIG, DRAFT_SKIP_POLICY } from "./config";
import { admitCommand } from "./admit";
import { reduceDraft } from "./reduce";
import { currentDeadline, teamOnClock } from "./selectors";
import { expireAt } from "./test-support";

const SPRINT_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];

const AUCTION_SLOTS: readonly RosterSlotConfig[] = [
  ...SPRINT_SLOTS,
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

const T = "2026-09-01T00:00:00.000Z";
const START: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, skipPolicy: DRAFT_SKIP_POLICY, timestamp: T, draftOrder: ["t1", "t2"], pool: POOL };

const snakeConfig: DraftConfig = {
  draftId: "d_s", leagueId: "l1", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null, slotConfig: SPRINT_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
};
const auctionConfig: DraftConfig = { ...snakeConfig, draftId: "d_a", format: "auction", auctionBudget: 10, slotConfig: AUCTION_SLOTS };

function apply(state: DraftState, action: Parameters<typeof reduceDraft>[1]): DraftState {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

const snake = () => apply(initialDraftState(snakeConfig), START);
const auction = () => apply(initialDraftState(auctionConfig), START);
const withLot = () => apply(auction(), { v: 1 as const, type: "NOMINATE" as const, timestamp: T, teamId: "t1", playerId: "qb1", openingBid: 3 });

describe("admitCommand — START_DRAFT", () => {
  it("admits a snake start, which has no budget to check", () => {
    expect(admitCommand(initialDraftState(snakeConfig), START)).toEqual({ ok: true });
  });

  it("admits an auction start with no budget at all — that rejection is the reducer's, with a better message", () => {
    const noBudget: DraftConfig = { ...auctionConfig, auctionBudget: null };
    expect(admitCommand(initialDraftState(noBudget), START)).toEqual({ ok: true });
    expect(reduceDraft(initialDraftState(noBudget), START)).toEqual({
      ok: false,
      reason: "An auction draft needs a budget before it can start.",
    });
  });

  it("admits an auction start with a zero budget for the same reason", () => {
    expect(admitCommand(initialDraftState({ ...auctionConfig, auctionBudget: 0 }), START)).toEqual({ ok: true });
  });

  it("rejects a budget that can't cover the minimum bid on every roster spot", () => {
    expect(admitCommand(initialDraftState({ ...auctionConfig, auctionBudget: 2 }), START)).toEqual({
      ok: false,
      reason: "An auction budget must be at least $1 for every roster spot.",
    });
  });

  it("admits a budget that covers every roster spot", () => {
    expect(admitCommand(initialDraftState(auctionConfig), START)).toEqual({ ok: true });
  });
});

describe("admitCommand — SET_QUEUE", () => {
  const queue = (playerIds: readonly string[]) => ({ v: 1 as const, type: "SET_QUEUE" as const, timestamp: T, teamId: "t1", playerIds });

  it("admits a queue at the cap", () => {
    const ids = Array.from({ length: DRAFT_QUEUE_CONFIG.maxLength }, (_, i) => `p${i}`);
    expect(admitCommand(snake(), queue(ids))).toEqual({ ok: true });
  });

  it("rejects a queue longer than the cap", () => {
    const ids = Array.from({ length: DRAFT_QUEUE_CONFIG.maxLength + 1 }, (_, i) => `p${i}`);
    expect(admitCommand(snake(), queue(ids))).toEqual({
      ok: false,
      reason: `A queue can hold at most ${DRAFT_QUEUE_CONFIG.maxLength} players.`,
    });
  });
});

describe("admitCommand — MAKE_PICK", () => {
  it("admits every pick: nothing about a pick depends on a tunable", () => {
    expect(admitCommand(snake(), { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" })).toEqual({ ok: true });
  });
});

describe("admitCommand — TIMER_EXPIRE (the clock must actually have run out, R-B4)", () => {
  it("rejects a snake expiry one second before the deadline, leaving state unchanged", () => {
    const started = snake();
    const deadline = currentDeadline(started)!;
    const early = new Date(Date.parse(deadline) - 1_000).toISOString();

    expect(admitCommand(started, { v: 1, type: "TIMER_EXPIRE", timestamp: early })).toEqual({
      ok: false,
      reason: "The clock hasn't run out yet.",
    });
    expect(started.picks).toHaveLength(0);
    expect(started.turnStartedAt).toBe(T);
  });

  it("admits a snake expiry exactly at the deadline", () => {
    const started = snake();
    expect(admitCommand(started, expireAt(started))).toEqual({ ok: true });
  });

  it("rejects an auction expiry before the bid window elapses, and admits it once it does", () => {
    const state = apply(withLot(), { v: 1, type: "BID", timestamp: T, teamId: "t2", amount: 4 });
    const deadline = currentDeadline(state)!;
    const early = new Date(Date.parse(deadline) - 1_000).toISOString();

    expect(admitCommand(state, { v: 1, type: "TIMER_EXPIRE", timestamp: early })).toEqual({
      ok: false,
      reason: "The clock hasn't run out yet.",
    });
    expect(admitCommand(state, { v: 1, type: "TIMER_EXPIRE", timestamp: deadline })).toEqual({ ok: true });
  });

  it("rejects a stale TIMER_EXPIRE whose timestamp predates a pick that already advanced the turn", () => {
    // The ticker's check-then-act race: it reads state and computes a deadline, but before it
    // submits TIMER_EXPIRE the on-clock team makes a legitimate (if late) pick. The ticker's
    // now-stale timestamp must not be allowed to autopick for whoever is next.
    const started = snake();
    const t1Deadline = currentDeadline(started)!;
    const t1PickTime = new Date(Date.parse(t1Deadline) + 1_000).toISOString();

    const afterPick = apply(started, { v: 1, type: "MAKE_PICK", timestamp: t1PickTime, teamId: "t1", playerId: "qb1" });
    expect(teamOnClock(afterPick)).toBe("t2");

    const stale: TimerExpireAction = { v: 1, type: "TIMER_EXPIRE", timestamp: t1Deadline };
    expect(admitCommand(afterPick, stale)).toEqual({ ok: false, reason: "The clock hasn't run out yet." });
  });

  it("admits an expiry when no clock is running at all", () => {
    expect(admitCommand(initialDraftState(snakeConfig), { v: 1, type: "TIMER_EXPIRE", timestamp: T })).toEqual({ ok: true });
  });
});

describe("admitCommand — NOMINATE", () => {
  const nominate = (teamId: string, playerId: string, openingBid: number) =>
    ({ v: 1 as const, type: "NOMINATE" as const, timestamp: T, teamId, playerId, openingBid });

  it("admits a nomination against a snake draft — that rejection is the reducer's", () => {
    expect(admitCommand(snake(), nominate("t1", "qb1", 0))).toEqual({ ok: true });
  });

  it("rejects an opening bid below the minimum", () => {
    expect(admitCommand(auction(), nominate("t1", "qb1", 0))).toEqual({ ok: false, reason: "The opening bid must be at least $1." });
  });

  it("rejects an opening bid above the nominator's maximum", () => {
    // $10 with 3 spots to fill: $2 is reserved for the other two.
    expect(admitCommand(auction(), nominate("t1", "qb1", 9))).toEqual({
      ok: false,
      reason: "You can only bid up to $8. You need $1 for each of your remaining roster spots.",
    });
  });

  it("admits an opening bid exactly at the nominator's maximum", () => {
    expect(admitCommand(auction(), nominate("t1", "qb1", 8))).toEqual({ ok: true });
  });

  it("admits a nomination from a team with no roster spots left — the reducer explains that one", () => {
    // A one-slot league: t1 fills its only spot, then tries to nominate again.
    const oneSlot: DraftConfig = { ...auctionConfig, slotConfig: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }] };
    let state = apply(initialDraftState(oneSlot), { ...START, pool: [{ playerId: "qb1", position: "QB" }, { playerId: "qb2", position: "QB" }] });
    state = apply(state, nominate("t1", "qb1", 1));
    state = apply(state, expireAt(state)); // t1 wins qb1 uncontested
    expect(admitCommand(state, nominate("t1", "qb2", 1))).toEqual({ ok: true });
  });
});

describe("admitCommand — BID", () => {
  const bid = (teamId: string, amount: number) => ({ v: 1 as const, type: "BID" as const, timestamp: T, teamId, amount });

  it("admits a bid against a snake draft — that rejection is the reducer's", () => {
    expect(admitCommand(snake(), bid("t1", 500))).toEqual({ ok: true });
  });

  it("admits a bid when no lot is open — there is no standing high bid to raise", () => {
    expect(admitCommand(auction(), bid("t2", 500))).toEqual({ ok: true });
  });

  it("rejects a bid that doesn't clear the increment", () => {
    expect(admitCommand(withLot(), bid("t2", 3))).toEqual({ ok: false, reason: "Your bid must be at least $4." });
  });

  it("rejects a bid above the bidder's maximum", () => {
    expect(admitCommand(withLot(), bid("t2", 9))).toEqual({
      ok: false,
      reason: "You can only bid up to $8. You need $1 for each of your remaining roster spots.",
    });
  });

  it("admits a bid exactly at the bidder's maximum", () => {
    expect(admitCommand(withLot(), bid("t2", 8))).toEqual({ ok: true });
  });
});
