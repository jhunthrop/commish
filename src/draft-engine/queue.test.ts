import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, SetQueueAction, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE, DRAFT_QUEUE_CONFIG } from "./config";
import { reduceDraft, type DraftReduceResult } from "./reduce";
import { bestAvailableFor, nudgeDeadline, queueFor } from "./selectors";
import { queuedEntriesFor } from "./queue";
import { expireAt } from "./test-support";

const SPRINT_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];

const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
];

const CONFIG: DraftConfig = {
  draftId: "draft_q",
  leagueId: "league_q",
  format: "snake",
  kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null,
  slotConfig: SPRINT_SLOTS,
  clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

const START: StartDraftAction = {
  v: 1,
  type: "START_DRAFT",
  timestamp: "2026-09-01T00:00:00.000Z",
  draftOrder: ["t1", "t2"],
  pool: POOL,
};

const EXPIRE = (timestamp: string) => ({ v: 1, type: "TIMER_EXPIRE", timestamp }) as const;

function setQueue(teamId: string, playerIds: readonly string[], timestamp = "2026-09-01T00:00:10.000Z"): SetQueueAction {
  return { v: 1, type: "SET_QUEUE", timestamp, teamId, playerIds };
}

function expectOk(result: DraftReduceResult): DraftState {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.state;
}

function started(): DraftState {
  return expectOk(reduceDraft(initialDraftState(CONFIG), START));
}

describe("SET_QUEUE", () => {
  it("is accepted before the draft starts, when there is no pool or draft order yet", () => {
    const state = expectOk(reduceDraft(initialDraftState(CONFIG), setQueue("t1", ["rb2", "qb2"])));
    expect(queueFor(state, "t1")).toEqual(["rb2", "qb2"]);
    expect(state.phase).toBe("scheduled");
    expect(state.sequence).toBe(1);
  });

  it("leaves the clock, the pick number and the phase alone", () => {
    const before = started();
    const after = expectOk(reduceDraft(before, setQueue("t1", ["rb2"])));
    expect(after.turnStartedAt).toBe(before.turnStartedAt);
    expect(after.pickNumber).toBe(before.pickNumber);
    expect(after.phase).toBe(before.phase);
    expect(after.sequence).toBe(before.sequence + 1);
  });

  it("replaces the previous queue rather than appending to it", () => {
    const first = expectOk(reduceDraft(started(), setQueue("t1", ["rb2", "qb2"])));
    const second = expectOk(reduceDraft(first, setQueue("t1", ["qb2"])));
    expect(queueFor(second, "t1")).toEqual(["qb2"]);
  });

  it("accepts an empty queue as a way to clear one", () => {
    const set = expectOk(reduceDraft(started(), setQueue("t1", ["rb2"])));
    const cleared = expectOk(reduceDraft(set, setQueue("t1", [])));
    expect(queueFor(cleared, "t1")).toEqual([]);
  });

  it("keeps each team's queue separate", () => {
    const one = expectOk(reduceDraft(started(), setQueue("t1", ["rb2"])));
    const two = expectOk(reduceDraft(one, setQueue("t2", ["qb2"])));
    expect(queueFor(two, "t1")).toEqual(["rb2"]);
    expect(queueFor(two, "t2")).toEqual(["qb2"]);
    expect(queueFor(two, "t_unknown")).toEqual([]);
  });

  it("rejects a duplicate player in one queue", () => {
    expect(reduceDraft(started(), setQueue("t1", ["rb2", "rb2"]))).toEqual({
      ok: false,
      reason: "Each player may appear in your queue only once.",
    });
  });

  it("rejects a queue longer than the configured maximum", () => {
    const tooMany = Array.from({ length: DRAFT_QUEUE_CONFIG.maxLength + 1 }, (_, i) => `p${i}`);
    expect(reduceDraft(initialDraftState(CONFIG), setQueue("t1", tooMany))).toEqual({
      ok: false,
      reason: `A queue can hold at most ${DRAFT_QUEUE_CONFIG.maxLength} players.`,
    });
  });

  it("rejects a team that isn't in this draft, once the draft order exists", () => {
    expect(reduceDraft(started(), setQueue("t9", ["rb2"]))).toEqual({
      ok: false,
      reason: "That team isn't in this draft.",
    });
  });

  it("rejects a player who isn't in the pool, once the pool exists", () => {
    expect(reduceDraft(started(), setQueue("t1", ["nobody"]))).toEqual({
      ok: false,
      reason: "That player isn't in this draft's player pool.",
    });
  });

  it("is rejected once the draft is complete", () => {
    // Two teams x two slots = four picks; expire the clock four times. Each expiry uses
    // `expireAt(state)` (the state's own current deadline) rather than a fixed timestamp:
    // once the clock reaches its final, kickoff-passed tier a reused fixed timestamp would
    // no longer be at-or-past the (now much shorter) deadline and TIMER_EXPIRE would be
    // rejected as premature — see R-B4 in `reduce.ts`.
    let state = started();
    for (let i = 0; i < 4; i++) state = expectOk(reduceDraft(state, expireAt(state)));
    expect(state.phase).toBe("complete");
    expect(reduceDraft(state, setQueue("t1", ["rb2"]))).toEqual({
      ok: false,
      reason: "This draft has already finished.",
    });
  });
});

describe("queue-first autopick", () => {
  it("takes the queue's first legally rosterable player instead of the pool's best", () => {
    const state = expectOk(reduceDraft(started(), setQueue("t1", ["rb2", "qb2"])));
    expect(bestAvailableFor(state, "t1")).toEqual({ playerId: "rb2", position: "RB" });
  });

  it("skips queued players who are already drafted, and those the roster can't take", () => {
    let state = expectOk(reduceDraft(started(), setQueue("t1", ["rb1", "qb2"])));
    // t1 autopicks rb1 (its queue head), t2 autopicks qb1 (the pool head). t1's RB slot is
    // now full, so the queue's remaining entry qb2 is the only legal one left in it.
    state = expectOk(reduceDraft(state, EXPIRE("2026-09-20T00:00:00.000Z")));
    state = expectOk(reduceDraft(state, EXPIRE("2026-09-20T00:01:00.000Z")));
    expect(state.picks.map((p) => p.playerId)).toEqual(["rb1", "qb1"]);
    expect(bestAvailableFor(state, "t1")).toEqual({ playerId: "qb2", position: "QB" });
  });

  it("ignores queued ids that aren't in the pool at all", () => {
    // A queue set before START_DRAFT can name a player the snapshotted pool never included.
    const queued = expectOk(reduceDraft(initialDraftState(CONFIG), setQueue("t1", ["ghost", "rb2"])));
    const state = expectOk(reduceDraft(queued, START));
    expect(queuedEntriesFor(state, "t1")).toEqual([{ playerId: "rb2", position: "RB" }]);
    expect(bestAvailableFor(state, "t1")).toEqual({ playerId: "rb2", position: "RB" });
  });

  it("falls back to the pool ranking when the queue is empty or exhausted", () => {
    expect(bestAvailableFor(started(), "t1")).toEqual({ playerId: "qb1", position: "QB" });
    const state = expectOk(reduceDraft(started(), setQueue("t1", [])));
    expect(bestAvailableFor(state, "t1")).toEqual({ playerId: "qb1", position: "QB" });
  });

  it("returns null when nothing in the queue or the pool can be rostered", () => {
    let state = started();
    // See the "is rejected once the draft is complete" test above for why `expireAt(state)`
    // rather than a fixed timestamp is required across repeated expiries.
    for (let i = 0; i < 4; i++) state = expectOk(reduceDraft(state, expireAt(state)));
    expect(bestAvailableFor(state, "t1")).toBeNull();
  });

  it("replays to the identical picks from the same action log", () => {
    const log = [START, setQueue("t1", ["rb2", "qb2"]), setQueue("t2", ["rb1"])];
    const run = () => {
      let state = initialDraftState(CONFIG);
      for (const action of log) state = expectOk(reduceDraft(state, action));
      // `expireAt(state)` is a pure function of `state` (via `currentDeadline`), so this
      // stays deterministic across the two `run()` calls exactly like a fixed timestamp
      // would — it's just derived instead of hand-picked, and correctly tracks the clock
      // tier tightening after each expiry.
      for (let i = 0; i < 4; i++) state = expectOk(reduceDraft(state, expireAt(state)));
      return state.picks.map((p) => `${p.teamId}:${p.playerId}`);
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual(["t1:rb2", "t2:rb1", "t2:qb1", "t1:qb2"]);
  });
});

describe("nudgeDeadline", () => {
  it("is the given percentage of the way through the current turn", () => {
    const state = started();
    // The 8-hour tier is in force (9+ days from kickoff): 75% of 28800s is 21600s.
    expect(nudgeDeadline(state, 75)).toBe("2026-09-01T06:00:00.000Z");
    expect(nudgeDeadline(state, 0)).toBe("2026-09-01T00:00:00.000Z");
  });

  it("is null when no turn is running", () => {
    expect(nudgeDeadline(initialDraftState(CONFIG), 75)).toBeNull();
  });
});
