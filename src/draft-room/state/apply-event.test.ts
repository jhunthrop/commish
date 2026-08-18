import { describe, it, expect } from "vitest";
import type { DraftClockView, DraftStateView } from "@/draft-engine";
import { applyDraftEvent } from "./apply-event";

const clock = (over: Partial<DraftClockView> = {}): DraftClockView => ({
  phase: "in_progress",
  sequence: 2,
  pickNumber: 2,
  onClockTeamId: "t2",
  deadlineAt: "2026-09-01T08:00:00.000Z",
  clockSeconds: 28_800,
  nextTightening: null,
  ...over,
});

const snakeView: DraftStateView = {
  ...clock({ sequence: 1, pickNumber: 1, onClockTeamId: "t1" }),
  draftId: "d1",
  leagueId: "l1",
  format: "snake",
  slotConfig: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }],
  draftOrder: ["t1", "t2"],
  picks: [],
  rosters: { t1: [], t2: [] },
  budgets: {},
  auction: null,
  availablePlayerIds: ["qb1", "rb1"],
  minBid: null,
  maxBids: {},
};

const auctionView: DraftStateView = {
  ...snakeView,
  format: "auction",
  budgets: { t1: 100, t2: 100 },
  minBid: 1,
  maxBids: { t1: 99, t2: 99 },
  auction: { nominatingTeamId: "t1", lot: null },
};

const frame = (type: string, payload: unknown) => JSON.stringify({ id: "1-0", type, leagueId: "l1", timestamp: "2026-09-01T00:00:00.000Z", payload });

/** The seven `DraftClockView` fields a view already carries, unchanged — the "sibling" clock. */
const clockOf = (view: DraftStateView): DraftClockView => ({
  phase: view.phase,
  sequence: view.sequence,
  pickNumber: view.pickNumber,
  onClockTeamId: view.onClockTeamId,
  deadlineAt: view.deadlineAt,
  clockSeconds: view.clockSeconds,
  nextTightening: view.nextTightening,
});

const pickPayload = {
  draftId: "d1",
  clock: clock(),
  pickNumber: 1,
  round: 1,
  teamId: "t1",
  playerId: "qb1",
  slot: "QB",
  slotIndex: 0,
  price: null,
  timestamp: "2026-09-01T00:05:00.000Z",
  auto: false,
};

describe("applyDraftEvent — framing and sequencing", () => {
  it("ignores anything that is not valid JSON", () => {
    expect(applyDraftEvent(snakeView, "not json")).toEqual({ ok: false, outcome: "ignored" });
  });

  it("ignores an event type this reducer does not own", () => {
    expect(applyDraftEvent(snakeView, frame("chat.message", { text: "hi" }))).toEqual({ ok: false, outcome: "ignored" });
  });

  it("ignores a malformed draft payload rather than trusting it", () => {
    expect(applyDraftEvent(snakeView, frame("draft.pick", { draftId: "d1" }))).toEqual({ ok: false, outcome: "ignored" });
  });

  it("ignores an event for a different draft on the same league stream", () => {
    expect(applyDraftEvent(snakeView, frame("draft.pick", { ...pickPayload, draftId: "other" }))).toEqual({ ok: false, outcome: "ignored" });
  });

  it("ignores an event we are already past", () => {
    const stale = { ...pickPayload, clock: clock({ sequence: 0 }) };
    expect(applyDraftEvent(snakeView, frame("draft.pick", stale))).toEqual({ ok: false, outcome: "ignored" });
  });

  it("asks for a resync when the sequence skips ahead", () => {
    const ahead = { ...pickPayload, clock: clock({ sequence: 5 }) };
    expect(applyDraftEvent(snakeView, frame("draft.pick", ahead))).toEqual({ ok: false, outcome: "resync" });
  });
});

describe("applyDraftEvent — draft.pick", () => {
  it("records the pick, fills the roster slot, drops the player from the pool and adopts the new clock", () => {
    const result = applyDraftEvent(snakeView, frame("draft.pick", pickPayload));
    expect(result.ok).toBe(true);
    const view = (result as { view: DraftStateView }).view;
    expect(view.picks).toEqual([
      { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:05:00.000Z", auto: false },
    ]);
    expect(view.rosters.t1).toEqual([{ slot: "QB", slotIndex: 0, playerId: "qb1" }]);
    expect(view.availablePlayerIds).toEqual(["rb1"]);
    expect(view.onClockTeamId).toBe("t2");
    expect(view.sequence).toBe(2);
  });

  it("is idempotent — a redelivered sibling event does not duplicate the pick", () => {
    const once = applyDraftEvent(snakeView, frame("draft.pick", pickPayload));
    const view = (once as { view: DraftStateView }).view;
    const twice = applyDraftEvent(view, frame("draft.pick", pickPayload));
    expect((twice as { view: DraftStateView }).view.picks).toHaveLength(1);
  });

  it("starts a roster for a team it has not seen before", () => {
    const bare: DraftStateView = { ...snakeView, rosters: {} };
    const view = (applyDraftEvent(bare, frame("draft.pick", pickPayload)) as { view: DraftStateView }).view;
    expect(view.rosters.t1).toHaveLength(1);
  });

  it("takes the awarded budgets, ceilings and next bid floor from the payload instead of doing arithmetic", () => {
    const withLot: DraftStateView = { ...auctionView, auction: { nominatingTeamId: "t1", lot: { playerId: "qb1", highBid: 30, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: false } } };
    const award = { ...pickPayload, price: 30, budgets: { t1: 70, t2: 100 }, maxBids: { t1: 70, t2: 99 }, minBid: 1, clock: clock({ onClockTeamId: "t2" }) };
    const view = (applyDraftEvent(withLot, frame("draft.pick", award)) as { view: DraftStateView }).view;
    expect(view.budgets).toEqual({ t1: 70, t2: 100 });
    expect(view.maxBids).toEqual({ t1: 70, t2: 99 });
    expect(view.minBid).toBe(1);
    expect(view.auction).toEqual({ nominatingTeamId: "t2", lot: null });
  });

  it("leaves minBid alone on a snake pick, where the payload never carries one", () => {
    const view = (applyDraftEvent(snakeView, frame("draft.pick", pickPayload)) as { view: DraftStateView }).view;
    expect(view.minBid).toBeNull();
  });
});

describe("applyDraftEvent — auction lots", () => {
  const nominate = { draftId: "d1", clock: clock({ onClockTeamId: null }), teamId: "t1", playerId: "qb1", openingBid: 5, auto: false, minBid: 6 };

  it("opens a lot on a nomination and takes the next bid floor from the payload", () => {
    const view = (applyDraftEvent(auctionView, frame("draft.nominate", nominate)) as { view: DraftStateView }).view;
    expect(view.auction).toEqual({
      nominatingTeamId: "t1",
      lot: { playerId: "qb1", highBid: 5, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: false },
    });
    expect(view.minBid).toBe(6);
  });

  it("asks for a resync if a nomination arrives for a snake draft", () => {
    expect(applyDraftEvent(snakeView, frame("draft.nominate", nominate))).toEqual({ ok: false, outcome: "resync" });
  });

  it("raises the high bid and bidder on a bid, and takes the new floor from the payload", () => {
    const opened = (applyDraftEvent(auctionView, frame("draft.nominate", nominate)) as { view: DraftStateView }).view;
    const bid = { draftId: "d1", clock: clock({ sequence: opened.sequence + 1, onClockTeamId: null }), teamId: "t2", playerId: "qb1", amount: 6, minBid: 7 };
    const view = (applyDraftEvent(opened, frame("draft.bid", bid)) as { view: DraftStateView }).view;
    expect(view.auction?.lot).toMatchObject({ highBid: 6, highBidTeamId: "t2" });
    expect(view.minBid).toBe(7);
  });

  it("asks for a resync when a bid arrives and we hold no open lot — the missed-bid-war case", () => {
    const bid = { draftId: "d1", clock: clock(), teamId: "t2", playerId: "qb1", amount: 6, minBid: 7 };
    expect(applyDraftEvent(auctionView, frame("draft.bid", bid))).toEqual({ ok: false, outcome: "resync" });
    expect(applyDraftEvent(snakeView, frame("draft.bid", bid))).toEqual({ ok: false, outcome: "resync" });
  });
});

describe("applyDraftEvent — clock-only events", () => {
  it("adopts the clock on a timer expiry", () => {
    const payload = { draftId: "d1", clock: clock({ onClockTeamId: "t2" }), pickNumber: 1 };
    const view = (applyDraftEvent(snakeView, frame("draft.timer_expire", payload)) as { view: DraftStateView }).view;
    expect(view.onClockTeamId).toBe("t2");
    expect(view.picks).toEqual([]);
  });

  it("adopts the phase on a status change", () => {
    const payload = { draftId: "d1", clock: clock({ phase: "complete", onClockTeamId: null, deadlineAt: null, clockSeconds: null }), phase: "complete" };
    const view = (applyDraftEvent(snakeView, frame("draft.status", payload)) as { view: DraftStateView }).view;
    expect(view.phase).toBe("complete");
    expect(view.deadlineAt).toBeNull();
  });
});

describe("applyDraftEvent — draft.queue and draft.nudge", () => {
  it("folds a draft.queue frame: the clock advances and nothing else changes", () => {
    const queuePayload = { draftId: "d1", clock: { ...clockOf(snakeView), sequence: snakeView.sequence + 1 }, teamId: "t2" };
    const result = applyDraftEvent(snakeView, frame("draft.queue", queuePayload));
    expect(result).toEqual({
      ok: true,
      view: { ...snakeView, sequence: snakeView.sequence + 1 },
      nudge: null,
    });
  });

  // The CRITICAL closure check (Task 2 review requirement): a rival's queue edit must fold
  // cleanly — clock/sequence advance, nothing else changes — so it never forces a resync, and
  // the NEXT real event right behind it applies normally instead of tripping the gap detector.
  it("a rival's draft.queue frame folds cleanly, and the next real event right behind it applies without a resync", () => {
    const queuePayload = { draftId: "d1", clock: { ...clockOf(snakeView), sequence: snakeView.sequence + 1 }, teamId: "t2" };
    const afterQueue = applyDraftEvent(snakeView, frame("draft.queue", queuePayload));
    expect(afterQueue).toEqual({ ok: true, view: { ...snakeView, sequence: snakeView.sequence + 1 }, nudge: null });
    const queuedView = (afterQueue as { view: DraftStateView }).view;

    const nextPick = { ...pickPayload, clock: clock({ sequence: snakeView.sequence + 2 }) };
    const afterPick = applyDraftEvent(queuedView, frame("draft.pick", nextPick));
    expect(afterPick.ok).toBe(true);
    expect((afterPick as { view: DraftStateView }).view.picks).toHaveLength(1);
  });

  it("surfaces a draft.nudge as a notice without moving the view", () => {
    const nudgePayload = { draftId: "d1", clock: clockOf(snakeView), teamId: "t1", message: "You're on the clock." };
    expect(applyDraftEvent(snakeView, frame("draft.nudge", nudgePayload))).toEqual({
      ok: true,
      view: snakeView,
      nudge: { teamId: "t1", message: "You're on the clock.", sequence: snakeView.sequence },
    });
  });

  it("ignores a nudge frame missing its message", () => {
    const malformed = { draftId: "d1", clock: clockOf(snakeView), teamId: "t1" };
    expect(applyDraftEvent(snakeView, frame("draft.nudge", malformed))).toEqual({ ok: false, outcome: "ignored" });
  });

  it("does not surface a nudge on a non-nudge frame", () => {
    const result = applyDraftEvent(snakeView, frame("draft.pick", pickPayload));
    expect(result.ok).toBe(true);
    expect((result as { nudge: unknown }).nudge).toBeNull();
  });
});
