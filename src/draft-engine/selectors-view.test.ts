import { describe, it, expect } from "vitest";
import type { DraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { DRAFT_CLOCK_SCHEDULE, DRAFT_SKIP_POLICY, AUCTION_CONFIG } from "./config";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { reduceDraft } from "./reduce";
import { draftClockView, draftStateView, maxBidsFor } from "./selectors";

const SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];

const POOL = [
  { playerId: "qb1", position: "QB" as const },
  { playerId: "rb1", position: "RB" as const },
  { playerId: "qb2", position: "QB" as const },
  { playerId: "rb2", position: "RB" as const },
];

function configFor(format: "snake" | "auction"): DraftConfig {
  return {
    draftId: "d1",
    leagueId: "l1",
    format,
    kickoffAt: "2026-09-30T17:00:00.000Z",
    auctionBudget: format === "auction" ? 100 : null,
    slotConfig: SLOTS,
    clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };
}

function apply(state: DraftState, action: DraftAction): DraftState {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
  return result.state;
}

function started(format: "snake" | "auction"): DraftState {
  return apply(initialDraftState(configFor(format)), {
    v: 1,
    type: "START_DRAFT", minBid: 1, skipPolicy: DRAFT_SKIP_POLICY,
    timestamp: "2026-09-01T00:00:00.000Z",
    draftOrder: ["t1", "t2"],
    pool: POOL,
  });
}

describe("draftClockView", () => {
  it("is quiet before the draft starts", () => {
    expect(draftClockView(initialDraftState(configFor("snake")))).toEqual({
      phase: "scheduled",
      sequence: 0,
      pickNumber: 0,
      onClockTeamId: null,
      deadlineAt: null,
      clockSeconds: null,
      nextTightening: null,
      upcoming: [],
      pausedUntil: null,
      owedPicks: {},
    });
  });

  it("reports the running turn once the draft is live", () => {
    const clock = draftClockView(started("snake"));
    expect(clock.phase).toBe("in_progress");
    expect(clock.sequence).toBe(1);
    expect(clock.pickNumber).toBe(1);
    expect(clock.onClockTeamId).toBe("t1");
    // 29 days from kickoff → the 8-hour tier.
    expect(clock.clockSeconds).toBe(8 * 60 * 60);
    expect(clock.deadlineAt).toBe("2026-09-01T08:00:00.000Z");
    expect(clock.nextTightening).toEqual({ at: "2026-09-23T17:00:00.000Z", pickSeconds: 4 * 60 * 60 });
  });

  it("has no team on the clock while an auction lot is open — the turn belongs to everyone, not one team", () => {
    const nominated = apply(started("auction"), {
      v: 1, type: "NOMINATE", timestamp: "2026-09-01T00:01:00.000Z", teamId: "t1", playerId: "qb1", openingBid: 5,
    });
    const clock = draftClockView(nominated);
    expect(clock.phase).toBe("in_progress");
    expect(clock.onClockTeamId).toBeNull();
  });
});

describe("maxBidsFor", () => {
  it("is empty for a snake draft — there is no budget to reserve against", () => {
    expect(maxBidsFor(started("snake"))).toEqual({});
  });

  it("holds back the reserve for every other open slot, for every team", () => {
    const state = started("auction");
    const reserve = AUCTION_CONFIG.reservePerOpenSlot;
    expect(maxBidsFor(state)).toEqual({ t1: 100 - reserve, t2: 100 - reserve });
  });
});

describe("draftStateView", () => {
  it("carries the league's roster shape, the pool ids, and no auction numbers for a snake draft", () => {
    const view = draftStateView(started("snake"));
    expect(view.slotConfig).toBe(SLOTS);
    expect(view.availablePlayerIds).toEqual(["qb1", "rb1", "qb2", "rb2"]);
    expect(view.minBid).toBeNull();
    expect(view.maxBids).toEqual({});
    expect(view.format).toBe("snake");
    expect(view.onClockTeamId).toBe("t1");
  });

  it("exposes the current minimum bid and every team's maximum for an auction", () => {
    const state = started("auction");
    expect(draftStateView(state).minBid).toBe(AUCTION_CONFIG.minBid);

    const nominated = apply(state, { v: 1, type: "NOMINATE", timestamp: "2026-09-01T00:01:00.000Z", teamId: "t1", playerId: "qb1", openingBid: 5 });
    const view = draftStateView(nominated);
    expect(view.minBid).toBe(5 + AUCTION_CONFIG.bidIncrement);
    expect(view.maxBids.t2).toBe(100 - AUCTION_CONFIG.reservePerOpenSlot);
    expect(view.auction?.lot?.highBidTeamId).toBe("t1");
  });

  it("records the slot index a pick landed in so no client has to derive it", () => {
    const picked = apply(started("snake"), { v: 1, type: "MAKE_PICK", timestamp: "2026-09-01T00:05:00.000Z", teamId: "t1", playerId: "qb1" });
    expect(draftStateView(picked).picks[0]).toMatchObject({ playerId: "qb1", slot: "QB", slotIndex: 0 });
  });
});
