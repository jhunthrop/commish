import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, MakePickAction, StartDraftAction, TimerExpireAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, totalPickCount, totalRosterSlots, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE, DRAFT_SKIP_POLICY } from "./config";
import { reduceDraft, type DraftReduceResult } from "./reduce";
import { isComplete, remainingBudget, teamOnClock } from "./selectors";
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

const T = "2026-09-01T00:00:00.000Z";
// A stale constant, used only where the exact timestamp doesn't matter (e.g. the
// draft-hasn't-started rejection, which is decided before any deadline check runs).
const EXPIRE: TimerExpireAction = { v: 1, type: "TIMER_EXPIRE", timestamp: "2026-09-01T01:00:00.000Z" };
const START: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, skipPolicy: DRAFT_SKIP_POLICY, timestamp: T, draftOrder: ["t1", "t2"], pool: POOL };

function apply(state: DraftState, action: Parameters<typeof reduceDraft>[1]): DraftState {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

function queueAction(teamId: string, playerIds: readonly string[]): Parameters<typeof reduceDraft>[1] {
  return { v: 1, type: "SET_QUEUE", timestamp: T, teamId, playerIds };
}

const snakeConfig: DraftConfig = {
  draftId: "d_s", leagueId: "l1", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null, slotConfig: SPRINT_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
};
const auctionConfig: DraftConfig = { ...snakeConfig, draftId: "d_a", format: "auction", auctionBudget: 10 };

// The "the clock must actually have run out" cases (R-B4) live in `admit.test.ts`: that guard
// reads `config.clockSchedule`, a tunable, so it is a command-time admission check rather than
// a reducer guard — a persisted TIMER_EXPIRE must stay replayable under a later schedule.

describe("TIMER_EXPIRE (snake)", () => {
  it("autopicks the best available player the team can roster and hands over the turn", () => {
    // Queued (Task 5): this fixture's kickoff is 9 days out (a slow tier), and a queueless team
    // there is skip-eligible now — this test is about the AUTOPICK shape, so t1's queue names
    // exactly the player `bestAvailableFor` would have picked anyway, keeping every assertion
    // below byte-identical to what it asserted before Task 5 existed.
    let started = apply(initialDraftState(snakeConfig), START);
    started = apply(started, queueAction("t1", ["qb1"]));
    const expire = expireAt(started);
    const state = apply(started, expire);
    expect(state.picks).toEqual([
      { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB", slotIndex: 0, price: null, timestamp: expire.timestamp, auto: true },
    ]);
    expect(teamOnClock(state)).toBe("t2");
  });

  it("skips a player the team can't roster and takes the next one it can", () => {
    // t1 takes qb1 by hand; on expiry t1's next autopick must be an RB, not qb2. t2 is queued
    // (Task 5) for the same reason as above — its round-2 turn is its first EXPIRY-driven one.
    let state = apply(initialDraftState(snakeConfig), START);
    state = apply(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" });
    state = apply(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t2", playerId: "qb2" });
    state = apply(state, queueAction("t2", ["rb1"]));
    state = apply(state, expireAt(state)); // round 2 reverses: t2 picks first
    expect(state.picks[2]?.teamId).toBe("t2");
    expect(state.picks[2]?.playerId).toBe("rb1");
  });

  it("completes the draft when the final autopick lands", () => {
    // Both teams queued (Task 5): otherwise this far-from-kickoff, no-queue fixture would skip
    // each team's first turn instead of completing in exactly four expiries.
    let state = apply(initialDraftState(snakeConfig), START);
    state = apply(state, queueAction("t1", ["qb1"]));
    state = apply(state, queueAction("t2", ["qb2"]));
    for (let i = 0; i < 4; i++) state = apply(state, expireAt(state));
    expect(isComplete(state)).toBe(true);
    expect(state.picks).toHaveLength(4);
    expect(state.picks.every((p) => p.auto)).toBe(true);
  });

  it("rejects an expiry before the draft has started", () => {
    expect(reduceDraft(initialDraftState(snakeConfig), EXPIRE)).toEqual({ ok: false, reason: "This draft hasn't started yet." });
  });

  it("rejects an expiry when no eligible player is available to auto-pick", () => {
    // SPRINT_SLOTS here has no BENCH, so a kicker fits nowhere in this league at all. Four
    // kickers (not one) so the pool still clears the "enough players to fill every roster"
    // count check at START_DRAFT — this test is about eligibility, not pool size. Queued
    // (Task 5) so this exercises the AUTOPICK path's rejection, not a skip: `bestAvailableFor`
    // still returns null even with a queue, because nothing in it (or the pool) is rosterable.
    const kickers: readonly DraftPoolEntry[] = [
      { playerId: "k1", position: "K" },
      { playerId: "k2", position: "K" },
      { playerId: "k3", position: "K" },
      { playerId: "k4", position: "K" },
    ];
    let state = apply(initialDraftState(snakeConfig), { ...START, pool: kickers });
    state = apply(state, queueAction("t1", ["k1"]));
    expect(reduceDraft(state, expireAt(state))).toEqual({ ok: false, reason: "No eligible player is available to auto-pick." });
  });
});

describe("TIMER_EXPIRE (auction)", () => {
  const started = () => apply(initialDraftState(auctionConfig), START);

  it("awards an open lot to the high bidder at the high bid and rotates the nomination", () => {
    let state = apply(started(), { v: 1, type: "NOMINATE", timestamp: T, teamId: "t1", playerId: "qb1", openingBid: 3 });
    state = apply(state, { v: 1, type: "BID", timestamp: T, teamId: "t2", amount: 4 });
    const expire = expireAt(state);
    state = apply(state, expire);
    expect(state.picks).toEqual([
      { pickNumber: 1, round: 1, teamId: "t2", playerId: "qb1", slot: "QB", slotIndex: 0, price: 4, timestamp: expire.timestamp, auto: false },
    ]);
    expect(remainingBudget(state, "t2")).toBe(6);
    expect(remainingBudget(state, "t1")).toBe(10);
    expect(state.pickNumber).toBe(2);
    expect(state.auction).toEqual({ nominatingTeamId: "t2", lot: null, minBid: 1 });
  });

  it("awards an unchallenged lot to the nominator at their opening bid", () => {
    let state = apply(started(), { v: 1, type: "NOMINATE", timestamp: T, teamId: "t1", playerId: "qb1", openingBid: 3 });
    state = apply(state, expireAt(state));
    expect(state.picks[0]?.teamId).toBe("t1");
    expect(state.picks[0]?.price).toBe(3);
    expect(state.picks[0]?.auto).toBe(false);
  });

  it("auto-nominates the nominating team's best available player at the minimum bid when they stall", () => {
    const s0 = started();
    const expire = expireAt(s0);
    const state = apply(s0, expire);
    expect(state.picks).toEqual([]);
    expect(state.auction?.lot).toEqual({
      playerId: "qb1", highBid: 1, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: true,
    });
    expect(state.turnStartedAt).toBe(expire.timestamp);
  });

  it("marks a pick auto when an auto-nominated lot goes unchallenged", () => {
    let state = apply(started(), expireAt(started()));
    state = apply(state, expireAt(state));
    expect(state.picks[0]).toMatchObject({ teamId: "t1", playerId: "qb1", price: 1, auto: true });
  });

  it("runs a whole auction to completion on the clock alone", () => {
    let state = started();
    for (let i = 0; i < 8; i++) state = apply(state, expireAt(state));
    expect(isComplete(state)).toBe(true);
    expect(state.picks).toHaveLength(4);
    expect(state.auction?.nominatingTeamId).toBeNull();
    expect(state.auction?.lot).toBeNull();
  });

  it("rejects an auto-nomination when the stalled team has no eligible player left at all", () => {
    // Only a QB slot exists — no BENCH — so once the pool's lone QB is gone, the
    // remaining WR fits nowhere and the next team's stall can't even auto-nominate.
    const qbOnlyConfig: DraftConfig = {
      ...auctionConfig, slotConfig: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }],
    };
    const qbOnlyPool: readonly DraftPoolEntry[] = [{ playerId: "qb1", position: "QB" }, { playerId: "wr1", position: "WR" }];
    let state = apply(initialDraftState(qbOnlyConfig), { ...START, pool: qbOnlyPool });
    state = apply(state, expireAt(state)); // t1 auto-nominates qb1
    state = apply(state, expireAt(state)); // t1 wins qb1 uncontested; t2 is up next
    expect(reduceDraft(state, expireAt(state))).toEqual({ ok: false, reason: "No eligible player is available to auto-pick." });
  });
});

// -----------------------------------------------------------------------------------------
// Task 5, Phase 3.5 — "skip and return": the forgiving timeout.
//
// The CONSENT ruling: a team WITH a queue gets autopick as today (they consented to it); NO
// queue in a SLOW tier skips and owes the pick (the draft moves on, they can make it any time —
// NFFC's forgiveness); NO queue in a FAST tier still autopicks (a live room can't wait); AUCTION
// is excluded entirely (a frozen nomination freezes everybody, a different product failure).
//
// Fixtures below are hand-built `DraftState` literals (the same pattern
// `selectors-upcoming.test.ts`'s own `live()` uses) rather than driven through a real
// START_DRAFT + a script of picks: what matters for a reducer test is the STATE a guard reads,
// not the history that could have produced it, and a literal states that plainly.
// -----------------------------------------------------------------------------------------

const TASK5_SLOTS: readonly RosterSlotConfig[] = [{ slot: "RB", count: 1, eligiblePositions: ["RB"] }];
const TASK5_TWO_ROUND_SLOTS: readonly RosterSlotConfig[] = [{ slot: "RB", count: 2, eligiblePositions: ["RB"] }];
const TASK5_POOL: readonly DraftPoolEntry[] = [
  { playerId: "p_1", position: "RB" },
  { playerId: "p_2", position: "RB" },
  { playerId: "p_3", position: "RB" },
  { playerId: "p_4", position: "RB" },
  { playerId: "p_5", position: "RB" },
  { playerId: "p_6", position: "RB" },
];
const ORDER3 = ["t_alice", "t_bob", "t_zoe"] as const;

// ~233h before kickoff: the 8h tier — `pickSeconds` (28800) sits well above the 1h skip floor.
const SLOW_START = "2026-09-01T00:00:00.000Z";
// 1h before kickoff: the 90s floor tier — a live room nobody can be skipped out of.
const FAST_START = "2026-09-10T16:00:00.000Z";
const KICKOFF = "2026-09-10T17:00:00.000Z";
// A redemption/catch-up action's own timestamp — distinct from either turn's `turnStartedAt`
// above, so `next.turnStartedAt === NOW` in the catch-up test is unambiguous evidence of a
// FRESH clock rather than a leftover value from the fixture.
const NOW = "2026-09-05T12:00:00.000Z";

function task5Config(over: Partial<DraftConfig> = {}): DraftConfig {
  return {
    draftId: "d_skip", leagueId: "l1", format: "snake", kickoffAt: KICKOFF,
    auctionBudget: null, slotConfig: TASK5_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
    skipPolicy: DRAFT_SKIP_POLICY,
    ...over,
  };
}

function task5State(over: Partial<DraftState>, config: DraftConfig = task5Config()): DraftState {
  return {
    ...initialDraftState(config),
    phase: "in_progress",
    sequence: 3,
    draftOrder: [...ORDER3],
    pool: TASK5_POOL,
    ...over,
  };
}

function expectOk(result: DraftReduceResult): DraftState {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.state;
}

function lastPick(state: DraftState) {
  return state.picks[state.picks.length - 1];
}

function rosterSize(state: DraftState, teamId: string): number {
  return (state.rosters[teamId] ?? []).length;
}

function timerExpire(timestamp: string = NOW): TimerExpireAction {
  return { v: 1, type: "TIMER_EXPIRE", timestamp };
}

function makePick(teamId: string, playerId: string, timestamp: string = NOW): MakePickAction {
  return { v: 1, type: "MAKE_PICK", timestamp, teamId, playerId };
}

describe("TIMER_EXPIRE — the skip-and-owe consent ruling (Task 5)", () => {
  it("autopicks a team that set a queue, because they already told us what to take", () => {
    const state = task5State({ pickNumber: 1, turnStartedAt: SLOW_START, queues: { t_alice: ["p_1"] } });
    const next = expectOk(reduceDraft(state, timerExpire()));
    expect(lastPick(next)).toMatchObject({ teamId: "t_alice", playerId: "p_1", auto: true });
    expect(next.owedPicks).toEqual({});
  });

  it("skips a team with no queue while the clock is slow, and owes them the pick", () => {
    const state = task5State({ pickNumber: 1, turnStartedAt: SLOW_START, queues: {} });
    const next = expectOk(reduceDraft(state, timerExpire()));
    expect(next.owedPicks).toEqual({ t_alice: [1] });
    expect(next.picks).toHaveLength(state.picks.length); // nothing was chosen for anybody
    expect(teamOnClock(next)).toBe("t_bob"); // the room moved on
  });

  it("autopicks instead of skipping once the clock has tightened, because the room is live", () => {
    // At the 90-second tier the draft is inside two hours of kickoff. A skip there is not
    // forgiveness, it is a hole in a live room that everybody else is sitting in.
    const state = task5State({ pickNumber: 1, turnStartedAt: FAST_START, queues: {} });
    expect(lastPick(expectOk(reduceDraft(state, timerExpire())))).toMatchObject({ teamId: "t_alice", auto: true });
  });

  it("autopicks the second time, because one owed pick per team is the whole allowance", () => {
    // t_alice's SECOND turn (pick 6 of 6 in this two-round board), already owing pick 1 from a
    // prior skip: `DRAFT_SKIP_POLICY.maxOwedPerTeam` is 1, so this stall autopicks instead.
    const twoRoundConfig = task5Config({ slotConfig: TASK5_TWO_ROUND_SLOTS });
    const state = task5State(
      { pickNumber: 6, turnStartedAt: SLOW_START, queues: {}, owedPicks: { t_alice: [1] } },
      twoRoundConfig,
    );
    expect(lastPick(expectOk(reduceDraft(state, timerExpire())))).toMatchObject({ teamId: "t_alice", auto: true });
  });

  it("leaves the auction alone, because a skipped nomination stalls everybody", () => {
    // `reduceAuctionExpiry` auto-nominates the nominator's best available at the minimum bid.
    // A skipped nomination would freeze a lot nobody can bid on, which is a different product
    // failure from the one this task is fixing — Task 5 excludes auction entirely.
    const auctionConfig = task5Config({ format: "auction", auctionBudget: 50 });
    const state = task5State(
      {
        pickNumber: 1, turnStartedAt: SLOW_START, queues: {},
        budgets: { t_alice: 50, t_bob: 50, t_zoe: 50 },
        auction: { nominatingTeamId: "t_alice", lot: null, minBid: 1 },
      },
      auctionConfig,
    );
    const next = expectOk(reduceDraft(state, timerExpire()));
    expect(next.auction?.lot).toMatchObject({ autoNominated: true });
    expect(next.owedPicks).toEqual({});
  });

  it("autopicks rather than skips when the config predates Task 5 entirely (no skipPolicy at all)", () => {
    // `DraftConfig.skipPolicy` is optional precisely for a hand-built state like this one that
    // never drove a real START_DRAFT (`state.ts`'s own docblock) — the reducer's fallback is to
    // never skip, the identical behavior this codebase had before Task 5 existed.
    const bareConfig: DraftConfig = {
      draftId: "d_skip", leagueId: "l1", format: "snake", kickoffAt: KICKOFF,
      auctionBudget: null, slotConfig: TASK5_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
      // skipPolicy deliberately absent — see the test's own name.
    };
    const state = task5State({ pickNumber: 1, turnStartedAt: SLOW_START, queues: {} }, bareConfig);
    const next = expectOk(reduceDraft(state, timerExpire()));
    expect(lastPick(next)).toMatchObject({ teamId: "t_alice", auto: true });
    expect(next.owedPicks).toEqual({});
  });
});

describe("MAKE_PICK — redeeming an owed pick, and the draft that waits for one (Task 5)", () => {
  it("lets a team make an owed pick on somebody else's turn", () => {
    const state = task5State({ pickNumber: 2, turnStartedAt: SLOW_START, queues: {}, owedPicks: { t_alice: [1] } });
    const next = expectOk(reduceDraft(state, makePick("t_alice", "p_4")));
    expect(next.owedPicks).toEqual({});
    expect(next.picks.at(-1)).toMatchObject({ teamId: "t_alice", pickNumber: 1, auto: false });
    expect(teamOnClock(next)).toBe("t_bob"); // redeeming does not steal the current turn
  });

  it("refuses an owed pick for a player somebody has since taken, and says so plainly", () => {
    const state = task5State({
      pickNumber: 3, turnStartedAt: SLOW_START, queues: {}, owedPicks: { t_alice: [1] },
      picks: [{ pickNumber: 2, round: 1, teamId: "t_bob", playerId: "p_4", slot: "RB", slotIndex: 0, price: null, timestamp: SLOW_START, auto: false }],
      rosters: { t_bob: [{ slot: "RB", slotIndex: 0, playerId: "p_4" }] },
    });
    expect(reduceDraft(state, makePick("t_alice", "p_4"))).toEqual({ ok: false, reason: "Somebody already drafted that player. Pick another." });
  });

  it("cannot complete a draft that still owes a pick", () => {
    // At the last pick number the draft would normally finish. An owed pick means a roster is
    // short, and every downstream consumer (commitDraftResults, defaultLineup, validateLineup)
    // assumes every team filled the same number of slots.
    const state = task5State({
      pickNumber: 3, turnStartedAt: SLOW_START, queues: {}, owedPicks: { t_alice: [1] },
      picks: [{ pickNumber: 2, round: 1, teamId: "t_bob", playerId: "p_2", slot: "RB", slotIndex: 0, price: null, timestamp: SLOW_START, auto: false }],
      rosters: { t_bob: [{ slot: "RB", slotIndex: 0, playerId: "p_2" }] },
    });
    const next = expectOk(reduceDraft(state, makePick("t_zoe", "p_3")));
    expect(next.phase).toBe("in_progress");
    expect(teamOnClock(next)).toBe("t_alice"); // a catch-up turn, on a fresh clock
    expect(next.turnStartedAt).toBe(NOW);
  });

  it("autopicks the catch-up turn if it expires too, so a draft always ends", () => {
    const state = task5State({
      pickNumber: 4, turnStartedAt: NOW, queues: {}, owedPicks: { t_alice: [1] },
      picks: [
        { pickNumber: 2, round: 1, teamId: "t_bob", playerId: "p_2", slot: "RB", slotIndex: 0, price: null, timestamp: SLOW_START, auto: false },
        { pickNumber: 3, round: 1, teamId: "t_zoe", playerId: "p_3", slot: "RB", slotIndex: 0, price: null, timestamp: NOW, auto: false },
      ],
      rosters: {
        t_bob: [{ slot: "RB", slotIndex: 0, playerId: "p_2" }],
        t_zoe: [{ slot: "RB", slotIndex: 0, playerId: "p_3" }],
      },
    });
    const next = expectOk(reduceDraft(state, timerExpire()));
    expect(next.phase).toBe("complete");
    expect(rosterSize(next, "t_alice")).toBe(totalRosterSlots(TASK5_SLOTS));
    expect(totalPickCount(state)).toBe(3); // sanity: pickNumber 4 really is past the board
  });

  it("settles a catch-up turn resolved by a direct pick, exactly like an expiry would", () => {
    const state = task5State({
      pickNumber: 4, turnStartedAt: NOW, queues: {}, owedPicks: { t_alice: [1] },
      picks: [
        { pickNumber: 2, round: 1, teamId: "t_bob", playerId: "p_2", slot: "RB", slotIndex: 0, price: null, timestamp: SLOW_START, auto: false },
        { pickNumber: 3, round: 1, teamId: "t_zoe", playerId: "p_3", slot: "RB", slotIndex: 0, price: null, timestamp: NOW, auto: false },
      ],
      rosters: {
        t_bob: [{ slot: "RB", slotIndex: 0, playerId: "p_2" }],
        t_zoe: [{ slot: "RB", slotIndex: 0, playerId: "p_3" }],
      },
    });
    const next = expectOk(reduceDraft(state, makePick("t_alice", "p_1")));
    expect(next.phase).toBe("complete");
    expect(rosterSize(next, "t_alice")).toBe(totalRosterSlots(TASK5_SLOTS));
  });

  it("lets a different team redeem during somebody else's catch-up turn, without disturbing it", () => {
    const state = task5State({
      pickNumber: 4, turnStartedAt: NOW, queues: {}, owedPicks: { t_alice: [1], t_bob: [2] },
      picks: [{ pickNumber: 3, round: 1, teamId: "t_zoe", playerId: "p_3", slot: "RB", slotIndex: 0, price: null, timestamp: NOW, auto: false }],
      rosters: { t_zoe: [{ slot: "RB", slotIndex: 0, playerId: "p_3" }] },
    });
    expect(teamOnClock(state)).toBe("t_alice"); // earliest owed pick number wins
    const next = expectOk(reduceDraft(state, makePick("t_bob", "p_2")));
    expect(next.owedPicks).toEqual({ t_alice: [1] }); // t_bob's redeemed, t_alice's own is untouched
    expect(next.picks.find((p) => p.teamId === "t_bob")).toMatchObject({ pickNumber: 2, auto: false });
    expect(teamOnClock(next)).toBe("t_alice"); // t_alice's catch-up turn was never stolen
    expect(next.turnStartedAt).toBe(NOW); // and its clock never reset
  });

  it("refuses a catch-up expiry when nothing is actually owed (an invariant-violating state a persisted log should never produce)", () => {
    const state = task5State({ pickNumber: 4, turnStartedAt: NOW, queues: {}, owedPicks: {} });
    expect(reduceDraft(state, timerExpire())).toEqual({ ok: false, reason: "No pick is currently owed." });
  });

  it("refuses a catch-up expiry when the owing team has no eligible player left to auto-pick", () => {
    // t_alice's one RB slot is already full, so `bestAvailableFor` finds nothing rosterable —
    // the catch-up path's own version of the ordinary autopick rejection above.
    const state = task5State({
      pickNumber: 4, turnStartedAt: NOW, queues: {}, owedPicks: { t_alice: [1] },
      picks: [{ pickNumber: 2, round: 1, teamId: "t_alice", playerId: "p_2", slot: "RB", slotIndex: 0, price: null, timestamp: NOW, auto: false }],
      rosters: { t_alice: [{ slot: "RB", slotIndex: 0, playerId: "p_2" }] },
    });
    expect(reduceDraft(state, timerExpire())).toEqual({ ok: false, reason: "No eligible player is available to auto-pick." });
  });
});
