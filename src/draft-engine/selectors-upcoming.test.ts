import { describe, it, expect } from "vitest";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
import { DRAFT_CLOCK_SCHEDULE, DRAFT_VIEW_CONFIG } from "./config";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { snakeTeamForPick } from "./order";
import { draftClockView, upcomingOnClock } from "./selectors";

const SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];

const ORDER = ["t1", "t2", "t3", "t4"] as const;
/** Two filled slots against a two-slot league: this team can never act again. */
const FULL_ROSTER: readonly RosterSlot[] = [
  { slot: "QB", slotIndex: 0, playerId: "qb9" },
  { slot: "RB", slotIndex: 0, playerId: "rb9" },
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

/**
 * A live draft posed as a literal. `upcomingOnClock` is a pure selector, so the boundaries
 * worth testing — the round turn, a roster that is already full, a rotation with nobody left
 * in it — are stated directly rather than driven there through dozens of reducer actions.
 */
function live(over: Partial<DraftState>, format: "snake" | "auction" = "snake"): DraftState {
  return {
    ...initialDraftState(configFor(format)),
    phase: "in_progress",
    sequence: 1,
    draftOrder: [...ORDER],
    pickNumber: 1,
    turnStartedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

function auctionLive(over: Partial<DraftState>): DraftState {
  return live({ auction: { nominatingTeamId: "t2", lot: null }, ...over }, "auction");
}

describe("upcomingOnClock — snake", () => {
  // Four teams, two roster spots each: eight picks total, running t1→t4 then t4→t1.
  it.each([
    ["from the top of the board", 1, 12, ["t1", "t2", "t3", "t4", "t4", "t3", "t2", "t1"]],
    ["across the round turn, where the order doubles back", 4, 3, ["t4", "t4", "t3"]],
    ["clipped at the last pick of the draft", 7, 5, ["t2", "t1"]],
    ["shorter than the board when the caller asks for less", 1, 3, ["t1", "t2", "t3"]],
    ["empty when the caller asks for nothing", 1, 0, []],
  ])("walks the serpentine %s", (_case, pickNumber, count, expected) => {
    expect(upcomingOnClock(live({ pickNumber }), count)).toEqual(expected);
  });

  it("reuses the engine's own serpentine walk rather than restating it", () => {
    const state = live({ pickNumber: 2 });
    expect(upcomingOnClock(state, 6)).toEqual([2, 3, 4, 5, 6, 7].map((pick) => snakeTeamForPick(state.draftOrder, pick)));
  });

  it("starts with whoever is on the clock right now", () => {
    expect(upcomingOnClock(live({ pickNumber: 6 }), 1)).toEqual(["t3"]);
  });
});

describe("upcomingOnClock — auction", () => {
  it("rotates the nomination order, cycling once it comes back around", () => {
    expect(upcomingOnClock(auctionLive({}), 6)).toEqual(["t2", "t3", "t4", "t1", "t2", "t3"]);
  });

  it("skips a team whose roster is already full", () => {
    expect(upcomingOnClock(auctionLive({ rosters: { t3: FULL_ROSTER } }), 4)).toEqual(["t2", "t4", "t1", "t2"]);
  });

  it("starts after the nominating team while their lot is still open — they have already acted", () => {
    const state = auctionLive({
      auction: {
        nominatingTeamId: "t2",
        lot: { playerId: "qb1", highBid: 5, highBidTeamId: "t3", nominatedByTeamId: "t2", autoNominated: false },
      },
    });
    expect(upcomingOnClock(state, 3)).toEqual(["t3", "t4", "t1"]);
  });

  it("terminates instead of cycling forever once the rotation has run out", () => {
    // Every roster full is the instant before the reducer marks the draft complete. The walk
    // names the standing nominator and then stops, rather than spinning to `count`.
    const rosters = Object.fromEntries(ORDER.map((teamId) => [teamId, FULL_ROSTER]));
    expect(upcomingOnClock(auctionLive({ rosters }), 5)).toEqual(["t2"]);
  });

  it("keeps naming the one team still able to roster somebody", () => {
    const rosters = Object.fromEntries(ORDER.filter((teamId) => teamId !== "t2").map((teamId) => [teamId, FULL_ROSTER]));
    expect(upcomingOnClock(auctionLive({ rosters }), 3)).toEqual(["t2", "t2", "t2"]);
  });

  it("is empty when the rotation has no nominator at all", () => {
    expect(upcomingOnClock(auctionLive({ auction: { nominatingTeamId: null, lot: null } }), 5)).toEqual([]);
  });
});

describe("upcomingOnClock — outside a running draft", () => {
  it.each([
    ["scheduled", initialDraftState(configFor("snake"))],
    ["complete", live({ phase: "complete" })],
  ])("has nobody upcoming while the draft is %s", (_phase, state) => {
    expect(upcomingOnClock(state, DRAFT_VIEW_CONFIG.upcomingCount)).toEqual([]);
  });
});

describe("draftClockView.upcoming", () => {
  it("rides the clock, capped at the configured count", () => {
    const many = live({ draftOrder: Array.from({ length: 20 }, (_, i) => `team${i + 1}`) });
    expect(draftClockView(many).upcoming).toHaveLength(DRAFT_VIEW_CONFIG.upcomingCount);
    expect(draftClockView(many).upcoming[0]).toBe(draftClockView(many).onClockTeamId);
  });

  it("is empty on a clock with nobody on it", () => {
    expect(draftClockView(initialDraftState(configFor("snake"))).upcoming).toEqual([]);
  });
});
