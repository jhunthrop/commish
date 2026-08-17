import { describe, it, expect } from "vitest";
import type { DraftAction, DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { DraftReplayError, replayDraft } from "./replay";

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
const LOG: readonly DraftAction[] = [
  START,
  { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" },
  { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t2", playerId: "rb1" },
];

describe("replayDraft", () => {
  it("reconstructs exactly the state produced by applying the same actions live", () => {
    let live = initialDraftState(CONFIG);
    for (const action of LOG) {
      const result = reduceDraft(live, action);
      if (!result.ok) throw new Error(result.reason);
      live = result.state;
    }
    expect(replayDraft(CONFIG, LOG)).toEqual(live);
  });

  it("returns the initial state for an empty log", () => {
    expect(replayDraft(CONFIG, [])).toEqual(initialDraftState(CONFIG));
  });

  it("throws a DraftReplayError naming the offending sequence when a persisted action can't apply", () => {
    const corrupt: readonly DraftAction[] = [...LOG, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" }];
    expect(() => replayDraft(CONFIG, corrupt)).toThrow(DraftReplayError);
    expect(() => replayDraft(CONFIG, corrupt)).toThrow(/action 4/);
  });
});
