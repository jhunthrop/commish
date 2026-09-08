import { describe, expect, it } from "vitest";
import type { DraftPoolEntry, MakePickAction, StartDraftAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { BENCH_SLOT, type RosterSlotConfig } from "@/domain/roster";
import { bestAvailableFor, initialDraftState, teamOnClock, totalPickCount, type DraftConfig, type DraftState } from "@/draft-engine";
import { BOT_ARCHETYPES } from "@/mock-draft/archetypes";
import { chooseBotPick } from "@/mock-draft/bots";
import { rngFor } from "@/mock-draft/rng";
import { continueRoom } from "./continue";
import { SIM_INSTANT, submit } from "./run";

// Draft order chosen (not alphabetic) so "t2" sits at a SNAKE TURN BOUNDARY: round 1 is
// [t1, t3, t4, t2] (picks 1-4), round 2 reverses to [t2, t4, t3, t1] (picks 5-8), so t2 holds
// picks 4 AND 5 back-to-back and t1 holds picks 1, 8 and 9.
const TEAM_IDS = ["t1", "t3", "t4", "t2"];

const ROSTER_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "WR", count: 1, eligiblePositions: ["WR"] },
  { slot: BENCH_SLOT, count: 1, eligiblePositions: ["QB", "RB", "WR", "TE"] },
]; // 3 slots/team x 4 teams = 12 total picks over 3 rounds — small on purpose.

const BOARD: readonly DraftPoolEntry[] = (() => {
  const plan: readonly (readonly [Position, number])[] = [["RB", 8], ["WR", 8], ["QB", 4], ["TE", 4]];
  const buckets = plan.map(([position, count]) => Array.from({ length: count }, (_, i) => ({ playerId: `${position.toLowerCase()}${i + 1}`, position })));
  const ranked = buckets.flatMap((bucket, bucketIndex) => bucket.map((entry, i) => ({ entry, rank: (i + 0.5) / bucket.length, bucketIndex })));
  ranked.sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex);
  return ranked.map((r) => r.entry);
})();

const CONFIG: DraftConfig = { draftId: "continue-fixture", leagueId: "sim", format: "snake", kickoffAt: SIM_INSTANT, auctionBudget: null, slotConfig: ROSTER_SLOTS, clockSchedule: [] };
const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: SIM_INSTANT, draftOrder: TEAM_IDS, pool: BOARD, minBid: 1 };
const NEUTRAL = BOT_ARCHETYPES.find((a) => a.name === "best_available")!;
const NONE: ReadonlySet<string> = new Set();

/** Advances a state by exactly `count` real picks, same submission path `continueRoom` itself
 *  uses, under a neutral archetype — fixture setup only, never the behavior under test. */
function advance(state: DraftState, seed: number, count: number): DraftState {
  let s = state;
  for (let i = 0; i < count; i++) {
    const teamId = teamOnClock(s);
    if (teamId === null) return s;
    const playerId = chooseBotPick(s, teamId, NEUTRAL, rngFor(seed, `${teamId}:fixture:${s.pickNumber}`));
    if (playerId === null) return s;
    const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId, playerId };
    s = submit(s, action);
  }
  return s;
}

function freshState(): DraftState {
  return submit(initialDraftState(CONFIG), START);
}

describe("continueRoom", () => {
  it("plays every pick from the current one through `throughPick`, in order, deterministically per seed", () => {
    const state = advance(freshState(), 1, 2); // pick 3 is up: t4
    const a = continueRoom({ state, seed: 7, throughPick: 7, excludeFromOnClockSeat: NONE });
    const b = continueRoom({ state, seed: 7, throughPick: 7, excludeFromOnClockSeat: NONE });
    expect(a).toEqual(b);
    expect(a.played.map((pick) => pick.pickNumber)).toEqual([3, 4, 5, 6, 7]);
    expect(a.played[0]).toMatchObject({ teamId: "t4", pickNumber: 3 });
    expect(a.draftEnded).toBe(false);
  });

  it("a different seed can produce a different continuation", () => {
    const state = advance(freshState(), 1, 3);
    const a = continueRoom({ state, seed: 7, throughPick: 12, excludeFromOnClockSeat: NONE });
    const b = continueRoom({ state, seed: 2, throughPick: 12, excludeFromOnClockSeat: NONE });
    expect(a.played).not.toEqual(b.played);
  });

  it("keeps the on-clock seat's CURRENT pick off the excluded players, and only that pick", () => {
    const state = advance(freshState(), 1, 3); // pick 4 is up: t2, who also holds pick 5
    expect(teamOnClock(state)).toBe("t2");
    // "rb3" is the player t2's own pick 4 would otherwise take under this fixture and seed.
    const unguarded = continueRoom({ state, seed: 7, throughPick: 5, excludeFromOnClockSeat: NONE });
    expect(unguarded.played[0]!.playerId).toBe("rb3");
    const guarded = continueRoom({ state, seed: 7, throughPick: 5, excludeFromOnClockSeat: new Set(["rb3"]) });
    expect(guarded.played[0]!.teamId).toBe("t2");
    expect(guarded.played[0]!.playerId).not.toBe("rb3");
    // Pick 5 is t2 again and plays under the seat's own driver with no exclusion.
    expect(guarded.played[1]).toMatchObject({ teamId: "t2", pickNumber: 5 });
  });

  it("stops with draftEnded when the draft completes before throughPick", () => {
    const total = totalPickCount(freshState());
    const state = advance(freshState(), 2, total - 1); // every pick played but the very last
    const result = continueRoom({ state, seed: 4, throughPick: total + 5, excludeFromOnClockSeat: NONE });
    expect(result.draftEnded).toBe(true);
    expect(result.played).toHaveLength(1);
  });

  it("never submits a command the engine refuses, across several seeds and stopping points", () => {
    for (const pickCount of [0, 1, 2, 3, 4, 7, 8, 11]) {
      const state = advance(freshState(), 2, pickCount);
      for (const seed of [1, 2, 3, 42]) {
        expect(() => continueRoom({ state, seed, throughPick: 12, excludeFromOnClockSeat: new Set(["rb1", "wr1"]) })).not.toThrow();
      }
    }
  });

  it("drives a seat on autopick with the autopick policy itself: every pick after the seeded on-clock one is the clock's own answer", () => {
    const state = advance(freshState(), 1, 2); // t4 is on the clock at pick 3
    const drivers = Object.fromEntries(TEAM_IDS.map((teamId) => [teamId, { kind: "autopick", picksObserved: 0 }] as const));
    const result = continueRoom({ state, seed: 1, throughPick: 8, excludeFromOnClockSeat: NONE, drivers });
    let replay = state;
    result.played.forEach((pick, index) => {
      if (index > 0) expect(bestAvailableFor(replay, pick.teamId)?.playerId).toBe(pick.playerId);
      const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId: pick.teamId, playerId: pick.playerId };
      replay = submit(replay, action);
    });
    expect(result.played).toHaveLength(6);
  });

  it("drives a seat with an inferred archetype under that archetype", () => {
    const state = advance(freshState(), 1, 2); // t4 on the clock at pick 3; t2 picks at 4 and 5
    const qbEarly = BOT_ARCHETYPES.find((archetype) => archetype.name === "qb_early")!;
    const asQbEarly = { t2: { kind: "archetype", archetype: qbEarly, basis: "inferred", picksObserved: 3 } } as const;
    const asNeutral = { t2: { kind: "archetype", archetype: NEUTRAL, basis: "prior", picksObserved: 0 } } as const;
    // This fixture's roster has no QB starter, so the need term damps every quarterback for
    // every brain: count how often t2's pick 4 is a QB under each driver across seeds, and
    // require the QB-first brain to take one more often than the neutral one.
    const quarterbacksUnder = (drivers: typeof asQbEarly | typeof asNeutral): number => {
      let count = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const result = continueRoom({ state, seed, throughPick: 4, excludeFromOnClockSeat: NONE, drivers });
        if (result.played.find((pick) => pick.pickNumber === 4)!.playerId.startsWith("qb")) count += 1;
      }
      return count;
    };
    expect(quarterbacksUnder(asQbEarly)).toBeGreaterThan(quarterbacksUnder(asNeutral));
  });
});
