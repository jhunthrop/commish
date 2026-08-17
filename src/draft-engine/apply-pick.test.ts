import { describe, it, expect } from "vitest";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { initialDraftState, rosterFor, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { applyPick, expectApplied, type ApplyPickResult } from "./apply-pick";

const CONFIG: DraftConfig = {
  draftId: "d1",
  leagueId: "l1",
  format: "snake",
  kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null,
  slotConfig: STANDARD_ROSTER_SLOTS,
  clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

describe("expectApplied", () => {
  it("unwraps the state from an ok result", () => {
    const state = initialDraftState(CONFIG);
    const result: ApplyPickResult = { ok: true, state };
    expect(expectApplied(result, "test invariant")).toBe(state);
  });

  it("throws, naming the invariant and the underlying reason, when the result is not ok", () => {
    const result: ApplyPickResult = { ok: false, reason: "That player has already been drafted." };
    expect(() => expectApplied(result, "test invariant")).toThrow(
      "Draft engine invariant violated (test invariant): That player has already been drafted.",
    );
  });
});

describe("applyPick — slotIndex", () => {
  function stateWithPool(): DraftState {
    return {
      ...initialDraftState(CONFIG),
      pool: [
        { playerId: "rb1", position: "RB" },
        { playerId: "rb2", position: "RB" },
      ],
    };
  }

  it("records slotIndex 0 for the first player landing in a slot", () => {
    const result = applyPick(stateWithPool(), { teamId: "t1", playerId: "rb1", price: null, auto: false, timestamp: "2026-09-01T00:00:00.000Z" });
    const state = expectApplied(result, "test setup");
    expect(state.picks[0]).toMatchObject({ slot: "RB", slotIndex: 0 });
  });

  it("records slotIndex 1 for the second RB of a two-RB roster", () => {
    const first = expectApplied(
      applyPick(stateWithPool(), { teamId: "t1", playerId: "rb1", price: null, auto: false, timestamp: "2026-09-01T00:00:00.000Z" }),
      "test setup",
    );
    const result = applyPick(first, { teamId: "t1", playerId: "rb2", price: null, auto: false, timestamp: "2026-09-01T00:01:00.000Z" });
    const state = expectApplied(result, "test setup");
    expect(state.picks[1]).toMatchObject({ slot: "RB", slotIndex: 1 });
    expect(rosterFor(state, "t1").map((s) => s.slotIndex)).toEqual([0, 1]);
  });
});
