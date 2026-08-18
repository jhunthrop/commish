import { describe, it, expect } from "vitest";
import type { DraftAction, DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig } from "./state";
import { DRAFT_CLOCK_SCHEDULE, DRAFT_QUEUE_CONFIG } from "./config";
import { reduceDraft } from "./reduce";
import { DraftReplayError, replayDraft } from "./replay";
import { currentDeadline } from "./selectors";
import { submitCommand } from "./test-support";

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

/**
 * The regression that cost a draft: a tunable changed between the day an action was accepted
 * and the day its log was replayed, and a reducer guard re-adjudicated history against the new
 * value. State must be a pure function of (config, log) — never of today's constants.
 */
describe("replayDraft survives a tunable changing under it", () => {
  it("replays a log recorded under a 60-second clock floor against a 90-second one, identically", () => {
    const sixtySecondClock: DraftConfig = { ...CONFIG, clockSchedule: [{ untilHoursBeforeKickoff: 0, pickSeconds: 60 }] };
    const ninetySecondClock: DraftConfig = { ...CONFIG, clockSchedule: [{ untilHoursBeforeKickoff: 0, pickSeconds: 90 }] };

    // Build the log the way the ticker did: every TIMER_EXPIRE lands exactly on the deadline
    // the 60-second schedule implied — 60s after the turn started, which the 90-second
    // schedule considers early.
    let state = initialDraftState(sixtySecondClock);
    const log: DraftAction[] = [];
    for (const action of [START, ...Array.from({ length: 4 }, () => null)]) {
      const next = action ?? { v: 1 as const, type: "TIMER_EXPIRE" as const, timestamp: currentDeadline(state)! };
      log.push(next);
      const result = submitCommand(state, next);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    expect(state.picks).toHaveLength(4);

    const replayed = replayDraft(ninetySecondClock, log);
    expect(replayed.picks).toEqual(state.picks);
    expect(replayed.phase).toBe("complete");
    // …and the deadline guard is still a live guard, just at command time: the same expiry
    // submitted fresh under the longer clock is rejected.
    const fresh = replayDraft(ninetySecondClock, [START]);
    expect(submitCommand(fresh, { v: 1, type: "TIMER_EXPIRE", timestamp: log[1]!.timestamp })).toEqual({
      ok: false,
      reason: "The clock hasn't run out yet.",
    });
  });

  it("replays a persisted queue longer than today's submission cap", () => {
    // `PERSISTED_QUEUE_MAX` (100) is deliberately higher than `DRAFT_QUEUE_CONFIG.maxLength`
    // (the submission tunable) so a queue accepted under an older, looser cap stays replayable
    // when the cap is lowered. A row longer than today's cap stands in for exactly that.
    const overCap = Array.from({ length: DRAFT_QUEUE_CONFIG.maxLength + 10 }, (_, i) => `p${i}`);
    const setQueue: DraftAction = { v: 1, type: "SET_QUEUE", timestamp: T, teamId: "t1", playerIds: overCap };

    expect(replayDraft(CONFIG, [setQueue]).queues["t1"]).toEqual(overCap);
    // Submitting the same queue today is still refused.
    expect(submitCommand(initialDraftState(CONFIG), setQueue)).toEqual({
      ok: false,
      reason: `A queue can hold at most ${DRAFT_QUEUE_CONFIG.maxLength} players.`,
    });
  });
});
