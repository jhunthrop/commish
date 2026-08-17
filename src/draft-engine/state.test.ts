import { describe, it, expect } from "vitest";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { auctionOf, initialDraftState, rosterFor, totalRosterSlots, type DraftConfig } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";

const config: DraftConfig = {
  draftId: "draft_1",
  leagueId: "league_1",
  format: "snake",
  kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null,
  slotConfig: STANDARD_ROSTER_SLOTS,
  clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

describe("totalRosterSlots", () => {
  it("sums every slot's count — the standard config is 15 rounds", () => {
    expect(totalRosterSlots(STANDARD_ROSTER_SLOTS)).toBe(15);
  });
  it("is 0 for an empty config", () => {
    expect(totalRosterSlots([])).toBe(0);
  });
});

describe("initialDraftState", () => {
  const state = initialDraftState(config);

  it("starts scheduled at sequence 0 with nothing drafted and no clock running", () => {
    expect(state.phase).toBe("scheduled");
    expect(state.sequence).toBe(0);
    expect(state.picks).toEqual([]);
    expect(state.draftOrder).toEqual([]);
    expect(state.pool).toEqual([]);
    expect(state.rosters).toEqual({});
    expect(state.budgets).toEqual({});
    expect(state.auction).toBeNull();
    expect(state.pickNumber).toBe(0);
    expect(state.turnStartedAt).toBeNull();
  });

  it("carries the config through unchanged", () => {
    expect(state.config).toBe(config);
  });

  it("has an empty roster for a team it has never seen", () => {
    expect(rosterFor(state, "nobody")).toEqual([]);
  });

  it("has no auction sub-state for a snake draft", () => {
    expect(auctionOf(state)).toBeNull();
  });
});
