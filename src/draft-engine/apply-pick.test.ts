import { describe, it, expect } from "vitest";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@research-ts/domain/roster";
import { initialDraftState, rosterFor, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { applyPick, expectApplied, redeemOwedPick, type ApplyPickResult } from "./apply-pick";

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

  it("stamps a redeemed pick's round and pickNumber from the OVERRIDE, never state.pickNumber (Task 5)", () => {
    // t1's real turn is pick 5 (`state.pickNumber`); this fills the slot they were skipped at
    // (pick 1) instead — the redeemed pick's own number, and the round derived from it.
    const state: DraftState = { ...stateWithPool(), draftOrder: ["t1", "t2"], pickNumber: 5 };
    const result = applyPick(state, { teamId: "t1", playerId: "rb1", price: null, auto: false, timestamp: "2026-09-01T00:00:00.000Z", pickNumber: 1 });
    expect(expectApplied(result, "test setup").picks[0]).toMatchObject({ pickNumber: 1, round: 1 });
  });
});

describe("redeemOwedPick", () => {
  const ONE_RB: readonly RosterSlotConfig[] = [{ slot: "RB", count: 1, eligiblePositions: ["RB"] }];

  function stateOwing(owed: readonly number[], over: Partial<DraftState> = {}): DraftState {
    return {
      ...initialDraftState({ ...CONFIG, slotConfig: ONE_RB }),
      pool: [
        { playerId: "rb1", position: "RB" },
        { playerId: "rb2", position: "RB" },
        { playerId: "rb3", position: "RB" },
      ],
      draftOrder: ["t1", "t2"],
      owedPicks: { t1: owed },
      ...over,
    };
  }

  it("refuses to redeem for a team whose owedPicks key is present but empty", () => {
    const state = stateOwing([]);
    expect(redeemOwedPick(state, { teamId: "t1", playerId: "rb1", auto: false, timestamp: "2026-09-01T00:00:00.000Z" })).toEqual({
      ok: false,
      reason: "This team doesn't owe a pick.",
    });
  });

  it("refuses to redeem for a team with no owedPicks entry at all", () => {
    // Distinct from the empty-array case above: `state.owedPicks[teamId] ?? []` covers the
    // KEY being entirely absent (the shape every real writer here produces — an emptied entry
    // is deleted outright, never left as `[]`), not just an empty one.
    const state = stateOwing([], { owedPicks: {} });
    expect(redeemOwedPick(state, { teamId: "t1", playerId: "rb1", auto: false, timestamp: "2026-09-01T00:00:00.000Z" })).toEqual({
      ok: false,
      reason: "This team doesn't owe a pick.",
    });
  });

  it("removes the team's owedPicks key entirely once its last owed pick is redeemed", () => {
    const state = stateOwing([3]);
    const result = expectApplied(
      redeemOwedPick(state, { teamId: "t1", playerId: "rb1", auto: false, timestamp: "2026-09-01T00:05:00.000Z" }),
      "test setup",
    );
    expect(result.picks[0]).toMatchObject({ pickNumber: 3, teamId: "t1", playerId: "rb1", auto: false });
    expect(result.owedPicks).toEqual({});
  });

  it("redeems the EARLIEST owed pick and leaves the rest, when a team owes more than one", () => {
    const state = stateOwing([3, 7]);
    const result = expectApplied(
      redeemOwedPick(state, { teamId: "t1", playerId: "rb1", auto: true, timestamp: "2026-09-01T00:05:00.000Z" }),
      "test setup",
    );
    expect(result.picks[0]).toMatchObject({ pickNumber: 3, auto: true });
    expect(result.owedPicks).toEqual({ t1: [7] });
  });

  it("gives the redemption-specific message for a player somebody else already took", () => {
    const state = stateOwing([3], { picks: [{ pickNumber: 1, round: 1, teamId: "t2", playerId: "rb1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false }] });
    expect(redeemOwedPick(state, { teamId: "t1", playerId: "rb1", auto: false, timestamp: "2026-09-01T00:05:00.000Z" })).toEqual({
      ok: false,
      reason: "Somebody already drafted that player. Pick another.",
    });
  });

  it("passes through an applyPick failure that isn't about the player being taken", () => {
    // t1's own RB slot is already full — a roster-shape rejection, not a "somebody took it" one.
    const state = stateOwing([3], { rosters: { t1: [{ slot: "RB", slotIndex: 0, playerId: "rb2" }] } });
    expect(redeemOwedPick(state, { teamId: "t1", playerId: "rb3", auto: false, timestamp: "2026-09-01T00:05:00.000Z" })).toEqual({
      ok: false,
      reason: "Your roster has no open slot for a RB.",
    });
  });
});
