import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { currentClockSeconds, currentDeadline, currentTier, draftStateView, nextTightening } from "./selectors";

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
const KICKOFF = "2026-09-10T17:00:00.000Z";
const CONFIG: DraftConfig = {
  draftId: "d1", leagueId: "l1", format: "snake", kickoffAt: KICKOFF,
  auctionBudget: null, slotConfig: SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

function startedAt(timestamp: string, config: DraftConfig = CONFIG): DraftState {
  const start: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp, draftOrder: ["t1", "t2"], pool: POOL };
  const result = reduceDraft(initialDraftState(config), start);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe("the auto-tightening clock, seen through the state", () => {
  it("gives four different pick durations for the same draft at four distances from kickoff", () => {
    const durations = [
      "2026-09-02T09:00:00.000Z",
      "2026-09-06T13:00:00.000Z",
      "2026-09-10T04:00:00.000Z",
      "2026-09-10T14:30:00.000Z",
    ].map((at) => currentClockSeconds(startedAt(at)));
    expect(durations).toEqual([8 * 3600, 4 * 3600, 3600, 600]);
    expect(new Set(durations).size).toBe(4);
  });

  it("derives the deadline from when the turn started plus the tier's pick seconds", () => {
    const state = startedAt("2026-09-10T14:30:00.000Z"); // 10-minute tier
    expect(currentDeadline(state)).toBe("2026-09-10T14:40:00.000Z");
    expect(currentTier(state)?.pickSeconds).toBe(600);
  });

  it("reports when the clock next shortens and to what", () => {
    expect(nextTightening(startedAt("2026-09-10T04:00:00.000Z"))).toEqual({ at: "2026-09-10T05:00:00.000Z", pickSeconds: 600 });
  });

  it("has no clock before the draft starts or after it finishes", () => {
    const scheduled = initialDraftState(CONFIG);
    expect(currentDeadline(scheduled)).toBeNull();
    expect(currentClockSeconds(scheduled)).toBeNull();
    expect(currentTier(scheduled)).toBeNull();
    expect(nextTightening(scheduled)).toBeNull();
  });

  it("shortens the window to the auction bid window while a lot is live", () => {
    const auctionConfig: DraftConfig = { ...CONFIG, format: "auction", auctionBudget: 10 };
    let state = startedAt("2026-09-02T09:00:00.000Z", auctionConfig); // 8-hour tier
    expect(currentClockSeconds(state)).toBe(8 * 3600);
    const nominated = reduceDraft(state, { v: 1, type: "NOMINATE", timestamp: "2026-09-02T09:05:00.000Z", teamId: "t1", playerId: "qb1", openingBid: 1 });
    if (!nominated.ok) throw new Error(nominated.reason);
    state = nominated.state;
    // Live bidding uses the shorter of the tier and the configured bid window.
    expect(currentClockSeconds(state)).toBe(15);
    expect(currentDeadline(state)).toBe("2026-09-02T09:05:15.000Z");
  });
});

describe("draftStateView", () => {
  it("serializes everything a client needs in one shape", () => {
    const state = startedAt("2026-09-10T14:30:00.000Z");
    const view = draftStateView(state);
    expect(view).toMatchObject({
      draftId: "d1",
      leagueId: "l1",
      format: "snake",
      phase: "in_progress",
      sequence: 1,
      draftOrder: ["t1", "t2"],
      pickNumber: 1,
      onClockTeamId: "t1",
      deadlineAt: "2026-09-10T14:40:00.000Z",
      clockSeconds: 600,
      nextTightening: { at: "2026-09-10T15:00:00.000Z", pickSeconds: 90 },
      picks: [],
      budgets: {},
      auction: null,
    });
    expect(view.availablePlayerIds).toEqual(["qb1", "rb1", "qb2", "rb2"]);
    expect(view.rosters).toEqual({ t1: [], t2: [] });
  });
});
