import { describe, expect, it, vi } from "vitest";
import type { DraftPoolEntry, MakePickAction, StartDraftAction } from "@research-ts/domain/draft";
import type { Position } from "@research-ts/domain/player";
import { BENCH_SLOT, type RosterSlotConfig } from "@research-ts/domain/roster";
import { availablePool, initialDraftState, teamOnClock, type DraftConfig, type DraftState } from "@/draft-engine";
import { BOT_ARCHETYPES } from "@/mock-draft/archetypes";
import { chooseBotPick } from "@/mock-draft/bots";
import { rngFor } from "@/mock-draft/rng";
import { continueRoom } from "./continue";
import { furthestNextTurn, nextTurnFor, seatsAheadFor, simulateRoomOdds, simulateRoomOddsInChunks, survivalFor } from "./room-odds";
import { SIM_INSTANT, submit } from "./run";

// 4-team snake [t1,t2,t3,t4], 3 slots each, 12 picks. t1 holds picks 1, 8 and 9; t2 holds 2, 7
// and 10; t3 holds 3, 6 and 11; t4 holds 4, 5 and 12.
const TEAM_IDS = ["t1", "t2", "t3", "t4"];
const ROSTER_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "WR", count: 1, eligiblePositions: ["WR"] },
  { slot: BENCH_SLOT, count: 1, eligiblePositions: ["QB", "RB", "WR", "TE"] },
];
const BOARD: readonly DraftPoolEntry[] = (() => {
  const plan: readonly (readonly [Position, number])[] = [["RB", 8], ["WR", 8], ["QB", 4], ["TE", 4]];
  const buckets = plan.map(([position, count]) => Array.from({ length: count }, (_, i) => ({ playerId: `${position.toLowerCase()}${i + 1}`, position })));
  const ranked = buckets.flatMap((bucket, bucketIndex) => bucket.map((entry, i) => ({ entry, rank: (i + 0.5) / bucket.length, bucketIndex })));
  ranked.sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex);
  return ranked.map((r) => r.entry);
})();
const CONFIG: DraftConfig = { draftId: "room-odds-fixture", leagueId: "sim", format: "snake", kickoffAt: SIM_INSTANT, auctionBudget: null, slotConfig: ROSTER_SLOTS, clockSchedule: [] };
const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: SIM_INSTANT, draftOrder: TEAM_IDS, pool: BOARD, minBid: 1 };
const NEUTRAL = BOT_ARCHETYPES.find((a) => a.name === "best_available")!;
const NONE: ReadonlySet<string> = new Set();

function freshState(): DraftState {
  return submit(initialDraftState(CONFIG), START);
}

function advance(state: DraftState, seed: number, count: number): DraftState {
  let s = state;
  for (let i = 0; i < count; i++) {
    const teamId = teamOnClock(s)!;
    const playerId = chooseBotPick(s, teamId, NEUTRAL, rngFor(seed, `${teamId}:fixture:${s.pickNumber}`))!;
    const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId, playerId };
    s = submit(s, action);
  }
  return s;
}

describe("nextTurnFor and furthestNextTurn", () => {
  it("names each seat's next pick after its current one, and the furthest of them", () => {
    expect(nextTurnFor(freshState(), "t1")).toBe(8);
    expect(nextTurnFor(freshState(), "t2")).toBe(2);
    expect(nextTurnFor(advance(freshState(), 1, 1), "t2")).toBe(7);
    expect(furthestNextTurn(freshState())).toBe(8);
    expect(furthestNextTurn(advance(freshState(), 1, 1))).toBe(8);
  });

  it("is null for a seat with no turn left, and the furthest is null only when nobody has one", () => {
    const state = advance(freshState(), 2, 10); // pick 11 (t3's last) is up; t4 still holds pick 12
    expect(nextTurnFor(state, "t1")).toBeNull();
    expect(nextTurnFor(state, "t3")).toBeNull(); // on the clock for its own last pick
    expect(furthestNextTurn(state)).toBe(12);
    expect(furthestNextTurn(advance(freshState(), 2, 11))).toBeNull();
  });
});

describe("simulateRoomOdds", () => {
  it("plays every run through the pick before the furthest next turn, reproducibly per seed", () => {
    const table = simulateRoomOdds({ state: freshState(), seed: 3, runs: 20, excludeFromOnClockSeat: NONE });
    expect(table.runs).toBe(20);
    expect(table.fromPick).toBe(1);
    expect(table.throughPick).toBe(7);
    expect(table.played).toHaveLength(20);
    for (const run of table.played) expect(run.map((pick) => pick.pickNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(simulateRoomOdds({ state: freshState(), seed: 3, runs: 20, excludeFromOnClockSeat: NONE })).toEqual(table);
  });

  it("still plays the on-clock pick when the exclusion covers the whole board, from the whole board", () => {
    const everyone = new Set(BOARD.map((entry) => entry.playerId));
    const table = simulateRoomOdds({ state: freshState(), seed: 3, runs: 5, excludeFromOnClockSeat: everyone });
    expect(table.played).toHaveLength(5);
    for (const run of table.played) expect(run.map((pick) => pick.pickNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("plays nothing when no seat has a next turn", () => {
    const state = advance(freshState(), 2, 12);
    const table = simulateRoomOdds({ state, seed: 1, runs: 5, excludeFromOnClockSeat: NONE });
    expect(table.throughPick).toBe(state.pickNumber - 1);
    expect(table.played.every((run) => run.length === 0)).toBe(true);
  });
});

describe("survivalFor", () => {
  it("reports every undrafted player at the seat's next turn over the runs that reached it, own picks never counting as gone", () => {
    const state = freshState();
    const table = simulateRoomOdds({ state, seed: 3, runs: 60, excludeFromOnClockSeat: new Set(["rb1"]) });
    const odds = survivalFor(table, state, "t1")!;
    expect(odds.pickNumber).toBe(8);
    expect(odds.runsReached).toBe(60);
    expect([...odds.survived.keys()].sort()).toEqual(availablePool(state).map((entry) => entry.playerId).sort());
    const deep = BOARD[BOARD.length - 1]!.playerId;
    expect(odds.survived.get(deep)).toBe(60);
    // rb1 was held off t1's own pick, so every run left him for the other seats to take.
    expect(odds.survived.get("rb1")!).toBeLessThan(60);
    // Whoever t1 took at pick 1 in a run is still counted as there for t1 at pick 8.
    for (const run of table.played) {
      const own = run[0]!;
      expect(own.teamId).toBe("t1");
      const takenByOthersBefore8 = table.played.filter((other) => other.some((pick) => pick.playerId === own.playerId && pick.teamId !== "t1" && pick.pickNumber < 8)).length;
      expect(odds.survived.get(own.playerId)).toBe(60 - takenByOthersBefore8);
    }
  });

  it("matches a per-seat continuation exactly for the same seed stream (tolerance 0: every pick draws from a seed keyed by seat and pick number, so the shared run's prefix IS the per-seat run)", () => {
    const state = advance(freshState(), 1, 1); // t2 on the clock at pick 2; t3's next turn is 3, t1's is 8
    const runs = 40;
    const table = simulateRoomOdds({ state, seed: 11, runs, excludeFromOnClockSeat: new Set(["rb2"]) });
    for (const teamId of ["t1", "t3", "t4"]) {
      const shared = survivalFor(table, state, teamId)!;
      const counts = new Map<string, number>(availablePool(state).map((entry) => [entry.playerId, 0]));
      for (let runIndex = 0; runIndex < runs; runIndex += 1) {
        const own = continueRoom({ state, seed: 11 + runIndex, throughPick: shared.pickNumber - 1, excludeFromOnClockSeat: new Set(["rb2"]) });
        const gone = new Set(own.played.filter((pick) => pick.teamId !== teamId).map((pick) => pick.playerId));
        for (const [id, count] of counts) if (!gone.has(id)) counts.set(id, count + 1);
      }
      expect(shared.runsReached).toBe(runs);
      for (const [id, count] of counts) expect(shared.survived.get(id)).toBe(count);
    }
  });

  it("is null for a seat with no next turn", () => {
    const state = advance(freshState(), 2, 10);
    const table = simulateRoomOdds({ state, seed: 1, runs: 5, excludeFromOnClockSeat: NONE });
    expect(survivalFor(table, state, "t1")).toBeNull();
    expect(survivalFor(table, state, "t4")!.pickNumber).toBe(12);
    expect(survivalFor(table, state, "t4")!.runsReached).toBe(5);
  });
});

describe("seatsAheadFor", () => {
  it("tallies what each seat between now and your next turn took most often, excluding your own current pick", () => {
    const state = freshState();
    const table = simulateRoomOdds({ state, seed: 4, runs: 40, excludeFromOnClockSeat: NONE });
    const ahead = seatsAheadFor(table, state, "t1");
    expect(ahead.map((seat) => seat.pickNumber)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(ahead.map((seat) => seat.teamId)).toEqual(["t2", "t3", "t4", "t4", "t3", "t2"]);
    for (const seat of ahead) {
      expect(seat.runs).toBe(40);
      expect(seat.topPosition!.share).toBeGreaterThan(0);
      expect(seat.topPosition!.share).toBeLessThanOrEqual(1);
      expect(seat.topPlayer).not.toBeNull();
    }
    expect(seatsAheadFor(table, state, "t2").map((seat) => seat.pickNumber)).toEqual([1]);
  });

  it("is empty for a seat with no next turn", () => {
    const state = advance(freshState(), 2, 11);
    const table = simulateRoomOdds({ state, seed: 1, runs: 5, excludeFromOnClockSeat: NONE });
    expect(seatsAheadFor(table, state, "t1")).toEqual([]);
  });
});

describe("simulateRoomOddsInChunks (the same runs, yielding to the event loop between chunks)", () => {
  it("answers byte for byte what the synchronous simulation answers for the same input, and yields between chunks", async () => {
    const state = advance(freshState(), 11, 3);
    const input = { state, seed: 99, runs: 20, excludeFromOnClockSeat: NONE };
    const yields = vi.fn(async () => undefined);
    const chunked = await simulateRoomOddsInChunks(input, { chunkRuns: 6, yieldToEventLoop: yields });
    expect(chunked).toEqual(simulateRoomOdds(input));
    // 20 runs in chunks of 6: three boundaries yield, the last chunk does not.
    expect(yields).toHaveBeenCalledTimes(3);
  });

  it("plays nothing, without yielding, when no seat has a next turn", async () => {
    const state = advance(freshState(), 11, 12);
    const yields = vi.fn(async () => undefined);
    const table = await simulateRoomOddsInChunks({ state, seed: 1, runs: 5, excludeFromOnClockSeat: NONE }, { chunkRuns: 2, yieldToEventLoop: yields });
    expect(table.played.every((run) => run.length === 0)).toBe(true);
    expect(yields).not.toHaveBeenCalled();
  });
});
