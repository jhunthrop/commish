import { describe, it, expect } from "vitest";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { initialDraftState, type DraftConfig } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { expectApplied, type ApplyPickResult } from "./apply-pick";

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
