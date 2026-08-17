import { describe, it, expect } from "vitest";
import { DRAFT_ACTION_VERSION, type DraftAction, type DraftPoolEntry, type StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { draftEventsFor } from "./events";
import { expireAt } from "./test-support";

const SLOTS: readonly RosterSlotConfig[] = [
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
const CONFIG: DraftConfig = {
  draftId: "d1", leagueId: "l1", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null, slotConfig: SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
};
const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: T, draftOrder: ["t1", "t2"], pool: POOL };

/** Applies an action and returns both the new state and the events it produced. */
function step(state: DraftState, action: DraftAction) {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(result.reason);
  return { state: result.state, events: draftEventsFor(state, result.state, action) };
}

describe("draftEventsFor", () => {
  it("announces the draft opening as a status event", () => {
    const { events } = step(initialDraftState(CONFIG), START);
    expect(events).toEqual([
      {
        type: "draft.status",
        payload: {
          draftId: "d1",
          phase: "in_progress",
          clock: {
            phase: "in_progress",
            sequence: 1,
            pickNumber: 1,
            onClockTeamId: "t1",
            deadlineAt: expect.any(String),
            clockSeconds: expect.any(Number),
            nextTightening: expect.anything(),
          },
        },
      },
    ]);
  });

  it("emits one draft.pick carrying the whole pick", () => {
    const opened = step(initialDraftState(CONFIG), START).state;
    const { events } = step(opened, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" });
    expect(events).toEqual([
      {
        type: "draft.pick",
        payload: {
          draftId: "d1",
          pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1",
          slot: "QB", slotIndex: 0, price: null, timestamp: T, auto: false,
          clock: {
            phase: "in_progress",
            sequence: 2,
            pickNumber: 2,
            onClockTeamId: "t2",
            deadlineAt: expect.any(String),
            clockSeconds: expect.any(Number),
            nextTightening: expect.anything(),
          },
        },
      },
    ]);
  });

  it("emits the expiry before the autopick it caused, so clients render them in order", () => {
    const opened = step(initialDraftState(CONFIG), START).state;
    const { events } = step(opened, expireAt(opened));
    expect(events.map((e) => e.type)).toEqual(["draft.timer_expire", "draft.pick"]);
  });

  it("emits draft.status when the last pick completes the draft", () => {
    let state = step(initialDraftState(CONFIG), START).state;
    let events: readonly { type: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const next = step(state, expireAt(state));
      state = next.state;
      events = next.events;
    }
    expect(events.map((e) => e.type)).toEqual(["draft.timer_expire", "draft.pick", "draft.status"]);
  });

  it("emits draft.nominate and draft.bid for auction lots", () => {
    const auctionConfig: DraftConfig = { ...CONFIG, format: "auction", auctionBudget: 10 };
    const opened = step(initialDraftState(auctionConfig), START).state;
    const nominated = step(opened, { v: 1, type: "NOMINATE", timestamp: T, teamId: "t1", playerId: "qb1", openingBid: 2 });
    expect(nominated.events).toEqual([
      {
        type: "draft.nominate",
        payload: {
          draftId: "d1", teamId: "t1", playerId: "qb1", openingBid: 2, auto: false,
          clock: expect.objectContaining({ sequence: 2 }),
        },
      },
    ]);
    const raised = step(nominated.state, { v: 1, type: "BID", timestamp: T, teamId: "t2", amount: 3 });
    expect(raised.events).toEqual([
      {
        type: "draft.bid",
        payload: {
          draftId: "d1", teamId: "t2", playerId: "qb1", amount: 3,
          clock: expect.objectContaining({ sequence: 3 }),
        },
      },
    ]);
  });

  it("emits the expiry then the nomination when the clock auto-nominates", () => {
    const auctionConfig: DraftConfig = { ...CONFIG, format: "auction", auctionBudget: 10 };
    const opened = step(initialDraftState(auctionConfig), START).state;
    const { events } = step(opened, expireAt(opened));
    expect(events.map((e) => e.type)).toEqual(["draft.timer_expire", "draft.nominate"]);
    expect(events[1]?.payload).toMatchObject({ auto: true, openingBid: 1 });
  });
});

const ONE_QB: readonly RosterSlotConfig[] = [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }];
const MONEY_POOL = [
  { playerId: "qb1", position: "QB" as const },
  { playerId: "qb2", position: "QB" as const },
];

function moneyStep(state: DraftState, action: DraftAction): DraftState {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
  return result.state;
}

function moneyConfigFor(format: "snake" | "auction"): DraftConfig {
  return {
    draftId: "d1",
    leagueId: "l1",
    format,
    kickoffAt: "2026-09-30T17:00:00.000Z",
    auctionBudget: format === "auction" ? 50 : null,
    slotConfig: ONE_QB,
    clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };
}

function moneyStartedDraft(format: "snake" | "auction"): DraftState {
  return moneyStep(initialDraftState(moneyConfigFor(format)), {
    v: DRAFT_ACTION_VERSION,
    type: "START_DRAFT",
    timestamp: "2026-09-01T00:00:00.000Z",
    draftOrder: ["t1", "t2"],
    pool: MONEY_POOL,
  });
}

describe("draftEventsFor — auction money on the pick event", () => {
  it("carries the post-award budgets and every team's reserve-adjusted ceiling", () => {
    const nominated = moneyStep(moneyStartedDraft("auction"), {
      v: DRAFT_ACTION_VERSION,
      type: "NOMINATE",
      timestamp: "2026-09-01T00:00:10.000Z",
      teamId: "t1",
      playerId: "qb1",
      openingBid: 12,
    });
    const expiry = expireAt(nominated);
    const awarded = moneyStep(nominated, expiry);

    const pickEvent = draftEventsFor(nominated, awarded, expiry).find((event) => event.type === "draft.pick")!;
    expect(pickEvent.payload).toMatchObject({
      draftId: "d1",
      teamId: "t1",
      playerId: "qb1",
      slot: "QB",
      slotIndex: 0,
      price: 12,
      // t1 spent $12 of $50; its only roster spot is now full, so its ceiling is $0.
      budgets: { t1: 38, t2: 50 },
      maxBids: { t1: 0, t2: 50 },
    });
    expect((pickEvent.payload as { readonly clock: { readonly sequence: number } }).clock.sequence).toBe(awarded.sequence);
  });

  it("omits budgets and ceilings entirely for a snake pick", () => {
    const started = moneyStartedDraft("snake");
    const pick: DraftAction = { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp: "2026-09-01T00:05:00.000Z", teamId: "t1", playerId: "qb1" };
    const after = moneyStep(started, pick);

    const pickEvent = draftEventsFor(started, after, pick).find((event) => event.type === "draft.pick")!;
    expect(pickEvent.payload).toMatchObject({ slot: "QB", slotIndex: 0, price: null });
    expect(pickEvent.payload).not.toHaveProperty("budgets");
    expect(pickEvent.payload).not.toHaveProperty("maxBids");
  });
});
