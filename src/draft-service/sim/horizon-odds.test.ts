import { describe, expect, it } from "vitest";
import type { DraftPoolEntry, MakePickAction, StartDraftAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { BENCH_SLOT, type RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, teamOnClock, type DraftConfig, type DraftState } from "@/draft-engine";
import { BOT_ARCHETYPES } from "@/mock-draft/archetypes";
import { chooseBotPick } from "@/mock-draft/bots";
import { rngFor } from "@/mock-draft/rng";
import { horizonOdds, upcomingTurnsFor } from "./horizon-odds";
import { SIM_INSTANT, submit } from "./run";

// The make-it-back fixture: 4-team snake [t1,t2,t3,t4], 3 slots each, 12 picks. t1 holds picks
// 1, 8 and 9; t2 holds 2, 7 and 10.
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
const CONFIG: DraftConfig = { draftId: "horizon-fixture", leagueId: "sim", format: "snake", kickoffAt: SIM_INSTANT, auctionBudget: null, slotConfig: ROSTER_SLOTS, clockSchedule: [] };
const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: SIM_INSTANT, draftOrder: TEAM_IDS, pool: BOARD, minBid: 1 };
const NEUTRAL = BOT_ARCHETYPES.find((a) => a.name === "best_available")!;

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

describe("upcomingTurnsFor", () => {
  it("lists the asking seat's next pick numbers after its current one, capped at the count and the draft's end", () => {
    expect(upcomingTurnsFor(freshState(), "t1", 3)).toEqual([8, 9]);
    expect(upcomingTurnsFor(freshState(), "t2", 3)).toEqual([2, 7, 10]);
    expect(upcomingTurnsFor(advance(freshState(), 1, 1), "t2", 3)).toEqual([7, 10]);
  });
});

describe("horizonOdds", () => {
  it("reports survival per target per upcoming turn, monotone non-increasing across turns, with the run count reached", () => {
    const state = freshState();
    const deep = BOARD[BOARD.length - 1]!.playerId;
    const top = BOARD[1]!.playerId;
    const result = horizonOdds({ state, askingTeamId: "t1", targetIds: [top, deep], seed: 3, runs: 60, horizon: 3 });
    expect(result.runs).toBe(60);
    expect(result.turns.map((turn) => turn.pickNumber)).toEqual([8, 9]);
    expect(result.turns[0]!.runsReached).toBe(60);
    expect(result.turns[1]!.runsReached).toBe(60);
    const [first, second] = result.turns;
    expect(first!.survival.get(deep)).toBe(1);
    expect(second!.survival.get(top)!).toBeLessThanOrEqual(first!.survival.get(top)!);
    expect(first!.survival.get(top)!).toBeLessThan(1);
  });

  it("tallies what each seat ahead of you took most often, with its share", () => {
    const state = advance(freshState(), 1, 1); // t2 on the clock for pick 2; asking seat t1 next at pick 8
    const result = horizonOdds({ state, askingTeamId: "t1", targetIds: ["rb2"], seed: 4, runs: 40, horizon: 1 });
    expect(result.seatsAhead.map((seat) => seat.pickNumber)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(result.seatsAhead.map((seat) => seat.teamId)).toEqual(["t2", "t3", "t4", "t4", "t3", "t2"]);
    for (const seat of result.seatsAhead) {
      expect(seat.runs).toBe(40);
      expect(seat.topPosition).not.toBeNull();
      expect(seat.topPosition!.share).toBeGreaterThan(0);
      expect(seat.topPosition!.share).toBeLessThanOrEqual(1);
      expect(seat.topPlayer).not.toBeNull();
    }
  });

  it("excludes the asking seat's own current pick from the seats ahead when it is on the clock", () => {
    const result = horizonOdds({ state: freshState(), askingTeamId: "t1", targetIds: ["rb2"], seed: 4, runs: 10, horizon: 1 });
    expect(result.seatsAhead.map((seat) => seat.pickNumber)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("is reproducible for the same seed", () => {
    const input = { state: freshState(), askingTeamId: "t2", targetIds: ["wr1", "rb3"], seed: 8, runs: 25, horizon: 2 } as const;
    expect(horizonOdds(input)).toEqual(horizonOdds(input));
  });

  it("has no turns and no seats ahead when the asking seat has no upcoming turn", () => {
    const state = advance(freshState(), 2, 11); // pick 12 (t4's last) is up; t1 finished at pick 9
    const result = horizonOdds({ state, askingTeamId: "t1", targetIds: ["te4"], seed: 1, runs: 5, horizon: 3 });
    expect(result.turns).toEqual([]);
    expect(result.seatsAhead).toEqual([]);
  });
});
