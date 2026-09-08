import { describe, expect, it } from "vitest";
import type { DraftPoolEntry, MakePickAction, StartDraftAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { BENCH_SLOT, type RosterSlotConfig } from "@/domain/roster";
import { availablePool, initialDraftState, teamOnClock, totalPickCount, type DraftConfig, type DraftState } from "@/draft-engine";
import { BOT_ARCHETYPES } from "@/mock-draft/archetypes";
import { chooseBotPick } from "@/mock-draft/bots";
import { rngFor } from "@/mock-draft/rng";
import { continueDraft } from "./continue";
import { SIM_INSTANT, submit } from "./run";

// Draft order chosen (not alphabetic) so the asking seat, "t2", sits at a SNAKE TURN BOUNDARY:
// round 1 is [t1, t3, t4, t2] (picks 1-4), round 2 reverses to [t2, t4, t3, t1] (picks 5-8), so
// t2 holds picks 4 AND 5 back-to-back. Replaying exactly 3 picks lands t2 on the clock for pick
// 4 — the "asking seat is CURRENTLY on the clock" branch — and because pick 5 is t2 again, the
// continuation's own next-turn stop is immediate and deterministic: nobody else ever gets a turn
// in between, so an id excluded from t2's own pick 4 is guaranteed to still be undrafted after.
const TEAM_IDS = ["t1", "t3", "t4", "t2"];

const ROSTER_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "WR", count: 1, eligiblePositions: ["WR"] },
  { slot: BENCH_SLOT, count: 1, eligiblePositions: ["QB", "RB", "WR", "TE"] },
]; // 3 slots/team x 4 teams = 12 total picks over 3 rounds — small on purpose (task brief).

const BOARD: readonly DraftPoolEntry[] = (() => {
  // Same generous-supply, rank-interleaved construction as run.test.ts's own BOARD, sized down:
  // plenty of RB/WR for every team's direct slot plus bench overflow, QB/TE for bench variety.
  const plan: readonly (readonly [Position, number])[] = [["RB", 8], ["WR", 8], ["QB", 4], ["TE", 4]];
  const buckets = plan.map(([position, count]) => Array.from({ length: count }, (_, i) => ({ playerId: `${position.toLowerCase()}${i + 1}`, position })));
  const ranked = buckets.flatMap((bucket, bucketIndex) => bucket.map((entry, i) => ({ entry, rank: (i + 0.5) / bucket.length, bucketIndex })));
  ranked.sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex);
  return ranked.map((r) => r.entry);
})();

const POOL_IDS: ReadonlySet<string> = new Set(BOARD.map((entry) => entry.playerId));

const CONFIG: DraftConfig = {
  draftId: "continue-fixture",
  leagueId: "sim",
  format: "snake",
  kickoffAt: SIM_INSTANT,
  auctionBudget: null,
  slotConfig: ROSTER_SLOTS,
  clockSchedule: [],
};

const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: SIM_INSTANT, draftOrder: TEAM_IDS, pool: BOARD, minBid: 1 };

const NEUTRAL = BOT_ARCHETYPES.find((a) => a.name === "best_available")!;

/** Advances a state by exactly `count` real picks, same submission path `continueDraft` itself
 *  uses, under a neutral archetype — fixture setup only, never the behavior under test. */
function advance(state: DraftState, seed: number, count: number): DraftState {
  let s = state;
  for (let i = 0; i < count; i++) {
    const teamId = teamOnClock(s);
    if (teamId === null) return s;
    const rng = rngFor(seed, `${teamId}:fixture:${s.pickNumber}`);
    const playerId = chooseBotPick(s, teamId, NEUTRAL, rng);
    if (playerId === null) return s;
    const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId, playerId };
    s = submit(s, action);
  }
  return s;
}

function freshState(): DraftState {
  return submit(initialDraftState(CONFIG), START);
}

describe("continueDraft", () => {
  it("continues a live state to the asking seat's next turn, deterministically per seed", () => {
    const state = advance(freshState(), 1, 3); // pick 4 is up next: t2, the asking seat
    expect(teamOnClock(state)).toBe("t2");
    // "rb3" is the player t2's own pick 4 would otherwise take (verified against this exact
    // fixture/seed) and is still on the board at this point — excluding anything already gone
    // (like "rb1", taken at pick 1) would prove nothing.
    const excluded = new Set(["rb3"]);

    const a = continueDraft({ state, askingTeamId: "t2", excludeFromAskingSeat: excluded, seed: 7 });
    const b = continueDraft({ state, askingTeamId: "t2", excludeFromAskingSeat: excluded, seed: 7 });
    expect(a.undrafted).toEqual(b.undrafted);
    // "rb3" was excluded from t2's OWN current pick (pick 4) by construction — filtered out of
    // the shadow candidate pool `continueDraft` feeds `chooseBotPick`. Pick 5 is t2 again (the
    // draft order's own turn boundary), so continuation stops right after pick 4 and no OTHER
    // seat ever got a turn to take "rb3" either: it must still be undrafted (or the draft ended,
    // or it was never on the board — the three ways this can hold in general).
    expect(a.undrafted.has("rb3") || a.draftEnded || !POOL_IDS.has("rb3")).toBe(true);
  });

  it("a different seed can produce a different continuation", () => {
    const state = advance(freshState(), 1, 3);
    const a = continueDraft({ state, askingTeamId: "t2", excludeFromAskingSeat: new Set(), seed: 7 });
    const b = continueDraft({ state, askingTeamId: "t2", excludeFromAskingSeat: new Set(), seed: 2 });
    expect(a.undrafted).not.toEqual(b.undrafted);
  });

  it("plays no exclusion for other seats when the asking seat is not on the clock", () => {
    const state = advance(freshState(), 1, 2); // pick 3 is up next: t4, not the asking seat t2
    expect(teamOnClock(state)).toBe("t4");
    const withExclusion = continueDraft({ state, askingTeamId: "t2", excludeFromAskingSeat: new Set(["rb1"]), seed: 3 });
    const withoutExclusion = continueDraft({ state, askingTeamId: "t2", excludeFromAskingSeat: new Set(), seed: 3 });
    // No seat played this turn is the asking seat, so the exclusion set can never be consulted —
    // the two runs must be identical.
    expect(withExclusion.undrafted).toEqual(withoutExclusion.undrafted);
    expect(withExclusion.draftEnded).toBe(withoutExclusion.draftEnded);
  });

  it("stops with draftEnded when no next turn exists", () => {
    const total = totalPickCount(freshState());
    const state = advance(freshState(), 2, total - 1); // every pick played but the very last
    expect(teamOnClock(state)).not.toBeNull();
    // t1 already took its 3rd and final pick (pick 9) three turns before the end of this 12-pick
    // draft — it has no next turn left, so continuation must run out the final pick and report
    // draftEnded.
    const result = continueDraft({ state, askingTeamId: "t1", excludeFromAskingSeat: new Set(), seed: 4 });
    expect(result.draftEnded).toBe(true);
    expect(availablePool(state).length).toBeGreaterThan(0); // sanity: fixture had leftover players
    expect(result.undrafted.size).toBe(availablePool(state).length - 1); // the final pick got made
  });

  it("never submits a command the engine refuses, across several seeds and stopping points", () => {
    for (const pickCount of [0, 1, 2, 3, 4, 7, 8, 11]) {
      const state = advance(freshState(), 2, pickCount);
      for (const seed of [1, 2, 3, 42]) {
        for (const askingTeamId of TEAM_IDS) {
          expect(() => continueDraft({ state, askingTeamId, excludeFromAskingSeat: new Set(["rb1", "wr1"]), seed })).not.toThrow();
        }
      }
    }
  });
});

// Draft advisor round, spec 3.1a: the continuation gains a horizon (the asking seat's Nth upcoming
// turn) and per-seat drivers (the inferred opponent model). Fixture reminder: t1 holds picks 1, 8
// and 9 of this 12-pick draft, so from a fresh state its UPCOMING turns are pick 8 and pick 9 and
// a third does not exist.
describe("continueDraft with a horizon", () => {
  it("defaults to one horizon, whose snapshot is the same set `undrafted` reports", () => {
    const state = freshState();
    const result = continueDraft({ state, askingTeamId: "t1", excludeFromAskingSeat: new Set(), seed: 9 });
    expect(result.undraftedAtTurn).toHaveLength(1);
    expect(result.undraftedAtTurn[0]).toEqual(result.undrafted);
    expect(result.draftEnded).toBe(false);
  });

  it("tallies a snapshot at every one of the asking seat's upcoming turns it reaches, and reports the draft ending before the horizon", () => {
    const state = freshState();
    const result = continueDraft({ state, askingTeamId: "t1", excludeFromAskingSeat: new Set(["wr1"]), seed: 9, horizon: 3 });
    expect(result.undraftedAtTurn).toHaveLength(2); // pick 8 and pick 9; no third turn exists
    expect(result.draftEnded).toBe(true);
    // Each later snapshot is a subset of the earlier one: players only ever leave the board.
    const [atFirst, atSecond] = result.undraftedAtTurn;
    for (const id of atSecond!) expect(atFirst!.has(id)).toBe(true);
    expect(atSecond!.size).toBeLessThan(atFirst!.size);
    // The excluded id was never taken by the asking seat's own picks (its current pick 1 and its
    // intermediate picks 8 and 9 all play under the exclusion); it may still have gone to another
    // seat. Three picks: the horizon was not reached, so the run played out the whole draft.
    const takenByAsking = result.played.filter((pick) => pick.teamId === "t1").map((pick) => pick.playerId);
    expect(takenByAsking).not.toContain("wr1");
    expect(takenByAsking).toHaveLength(3);
  });

  it("records every pick the run played, in pick order, with the seat that made it", () => {
    const state = advance(freshState(), 1, 2); // t4 on the clock for pick 3; asking seat t2 holds pick 4
    const result = continueDraft({ state, askingTeamId: "t2", excludeFromAskingSeat: new Set(), seed: 5, horizon: 2 });
    expect(result.played[0]).toMatchObject({ teamId: "t4", pickNumber: 3 });
    const numbers = result.played.map((pick) => pick.pickNumber);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(numbers[0]).toBe(3);
  });

  it("drives a seat on autopick with the autopick policy itself, so its pick never varies with the seed", () => {
    const state = advance(freshState(), 1, 2); // t4 is on the clock; the asking seat t2 is not
    const drivers = Object.fromEntries(TEAM_IDS.map((teamId) => [teamId, { kind: "autopick", picksObserved: 0 }] as const));
    const a = continueDraft({ state, askingTeamId: "t2", excludeFromAskingSeat: new Set(), seed: 1, drivers });
    const b = continueDraft({ state, askingTeamId: "t2", excludeFromAskingSeat: new Set(), seed: 2, drivers });
    expect(a.undrafted).toEqual(b.undrafted);
    expect(a.played).toEqual(b.played);
  });

  it("drives a seat with an inferred archetype under that archetype", () => {
    const state = advance(freshState(), 1, 2);
    const qbEarly = BOT_ARCHETYPES.find((archetype) => archetype.name === "qb_early")!;
    const asQbEarly = { t4: { kind: "archetype", archetype: qbEarly, basis: "inferred", picksObserved: 3 } } as const;
    const asNeutral = { t4: { kind: "archetype", archetype: NEUTRAL, basis: "prior", picksObserved: 0 } } as const;
    // This fixture's roster has no QB starter, so the need term damps every quarterback for
    // every brain: count how often t4's pick 3 is a QB under each driver across seeds, and
    // require the QB-first brain to take one more often than the neutral one.
    const quarterbacksUnder = (drivers: typeof asQbEarly | typeof asNeutral): number => {
      let count = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const result = continueDraft({ state, askingTeamId: "t2", excludeFromAskingSeat: new Set(), seed, drivers });
        if (result.played.find((pick) => pick.pickNumber === 3)!.playerId.startsWith("qb")) count += 1;
      }
      return count;
    };
    expect(quarterbacksUnder(asQbEarly)).toBeGreaterThan(quarterbacksUnder(asNeutral));
  });
});
