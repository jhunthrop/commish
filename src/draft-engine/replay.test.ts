import { describe, it, expect } from "vitest";
import type { DraftAction, DraftPoolEntry, StartDraftAction } from "@research-ts/domain/draft";
import type { RosterSlotConfig } from "@research-ts/domain/roster";
import { draftActionSchema } from "./action-schema";
import { initialDraftState, type DraftConfig } from "./state";
import { DRAFT_CLOCK_SCHEDULE, DRAFT_QUEUE_CONFIG, DRAFT_SKIP_POLICY } from "./config";
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
const START: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, skipPolicy: DRAFT_SKIP_POLICY, timestamp: T, draftOrder: ["t1", "t2"], pool: POOL };
const LOG: readonly DraftAction[] = [
  START,
  { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" },
  { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t2", playerId: "rb1" },
];

describe("the roster-status gate's mark on a START_DRAFT snapshot (fix round, LOW)", () => {
  const marked: readonly DraftPoolEntry[] = [POOL[0]!, { ...POOL[1]!, excludedFromAutopick: true }, POOL[2]!, POOL[3]!];

  it("round-trips through the persisted action schema, absent staying absent and true staying true", () => {
    const parsed = draftActionSchema.parse(JSON.parse(JSON.stringify({ ...START, pool: marked })));
    expect(parsed.type).toBe("START_DRAFT");
    if (parsed.type !== "START_DRAFT") throw new Error("unreachable");
    expect(parsed.pool).toEqual(marked);
    expect("excludedFromAutopick" in parsed.pool[0]!).toBe(false);
    expect(parsed.pool[1]!.excludedFromAutopick).toBe(true);
  });

  it("refuses any value but true for the mark, so a log can never carry a false that reads as eligible", () => {
    expect(() => draftActionSchema.parse({ ...START, pool: [{ playerId: "rb1", position: "RB", excludedFromAutopick: false }] })).toThrow();
  });

  it("replays into the state's pool with the mark intact, and a manager's own pick of him still lands", () => {
    const log: readonly DraftAction[] = [{ ...START, pool: marked }, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "rb1" }];
    const state = replayDraft(CONFIG, log.map((action) => draftActionSchema.parse(action)));
    expect(state.pool[1]).toEqual({ playerId: "rb1", position: "RB", excludedFromAutopick: true });
    expect(state.picks.map((pick) => pick.playerId)).toEqual(["rb1"]);
  });
});

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

  it("auto-nominates a stalled auction at the START_DRAFT snapshot's minBid, not today's tunable", () => {
    // A log recorded when the minimum bid was $3. If the fold read `AUCTION_CONFIG.minBid`
    // ($1) instead of the snapshot, replaying this draft would silently rewrite the opening
    // price of every auto-nominated lot in its history.
    const auctionConfig: DraftConfig = { ...CONFIG, format: "auction", auctionBudget: 200 };
    const start: StartDraftAction = { ...START, minBid: 3 };
    const stalledNomination: DraftAction = { v: 1, type: "TIMER_EXPIRE", timestamp: T };

    const replayed = replayDraft(auctionConfig, [start, stalledNomination]);
    expect(replayed.auction?.lot).toMatchObject({ highBid: 3, autoNominated: true });
  });

  it("skips a queueless team at the START_DRAFT snapshot's allowance, not today's DRAFT_SKIP_POLICY (Task 5)", () => {
    // A log recorded when the allowance was 2 owed picks per team. If the fold read
    // `DRAFT_SKIP_POLICY` ($1) instead of the snapshot, replaying this draft would silently
    // rewrite an already-decided skip into an autopick (or vice versa) the next time it loaded.
    const generousStart: StartDraftAction = { ...START, skipPolicy: { maxOwedPerTeam: 2, appliesAtOrAbovePickSeconds: 60 * 60 } };
    // Slow tier (8h, well past the 1h floor), no queue for either team: t1 owes pick 1, t2 owes
    // pick 2, under the 2-per-team allowance the ACTION carries — never today's DRAFT_SKIP_POLICY
    // (1 per team), which would have autopicked both instead.
    const log: readonly DraftAction[] = [
      generousStart,
      { v: 1, type: "TIMER_EXPIRE", timestamp: T },
      { v: 1, type: "TIMER_EXPIRE", timestamp: T },
    ];
    const replayed = replayDraft(CONFIG, log);
    expect(replayed.owedPicks).toEqual({ t1: [1], t2: [2] });
    expect(replayed.picks).toEqual([]);
  });

  it("autopicks a queueless team when the log predates Task 5 entirely, rather than skipping under today's allowance", () => {
    // FINAL WHOLE-BRANCH REVIEW, F3. A `START_DRAFT` row written before `skipPolicy` existed used
    // to parse with `.default(DRAFT_SKIP_POLICY)`, which handed a draft that ran under NO skipping
    // rule whatsoever the rule in force today — and skipping is not a cosmetic difference: this
    // exact log autopicked in real life and would replay as two owed picks and an empty roster.
    // Parsed through the REAL persisted-row boundary (`draftActionSchema`), not hand-built with
    // the field deleted, because the schema is where the drift lived.
    const legacyRow = {
      v: 1, type: "START_DRAFT", minBid: 1, timestamp: T,
      draftOrder: ["t1", "t2"], pool: [...POOL],
      // `skipPolicy` deliberately absent — this IS the pre-Task-5 shape.
    };
    const legacyStart = draftActionSchema.parse(legacyRow);
    // The identical fixture the test above skips under: a slow tier (this draft's kickoff is 9
    // days out, well past the 1h floor) with no queue for either team. The ONLY difference is
    // that the action carries no allowance.
    const log: readonly DraftAction[] = [
      legacyStart,
      { v: 1, type: "TIMER_EXPIRE", timestamp: T },
      { v: 1, type: "TIMER_EXPIRE", timestamp: T },
    ];

    const replayed = replayDraft(CONFIG, log);

    expect(replayed.owedPicks).toEqual({});
    expect(replayed.picks.map((pick) => ({ teamId: pick.teamId, auto: pick.auto }))).toEqual([
      { teamId: "t1", auto: true },
      { teamId: "t2", auto: true },
    ]);
  });
});
