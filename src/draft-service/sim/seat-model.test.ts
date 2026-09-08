import { describe, expect, it } from "vitest";
import type { DraftPoolEntry, MakePickAction, StartDraftAction, TimerExpireAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { availablePool, DRAFT_CLOCK_SCHEDULE, initialDraftState, teamOnClock, type DraftConfig, type DraftState } from "@/draft-engine";
import { BOT_ARCHETYPES } from "@/mock-draft/archetypes";
import { chooseBotPick } from "@/mock-draft/bots";
import { rngFor } from "@/mock-draft/rng";
import { SIM_INSTANT, submit } from "./run";
import { inferSeatDriver, inferSeatDrivers, SEAT_MODEL_CONFIG } from "./seat-model";

const TEAMS = Array.from({ length: 12 }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);

/** The same proportional interleave every sim fixture uses — a realistic mixed board. */
const POOL: readonly DraftPoolEntry[] = (() => {
  const plan: readonly (readonly [Position, number])[] = [["QB", 30], ["RB", 70], ["WR", 80], ["TE", 30], ["K", 20], ["DEF", 20]];
  const buckets = plan.map(([position, count]) => Array.from({ length: count }, (_, i) => ({ playerId: `${position.toLowerCase()}${i + 1}`, position })));
  const ranked = buckets.flatMap((bucket, bucketIndex) => bucket.map((entry, i) => ({ entry, rank: (i + 0.5) / bucket.length, bucketIndex })));
  ranked.sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex);
  return ranked.map((r) => r.entry);
})();

const CONFIG: DraftConfig = {
  draftId: "seat-model-fixture",
  leagueId: "sim",
  format: "snake",
  kickoffAt: SIM_INSTANT,
  auctionBudget: null,
  slotConfig: STANDARD_ROSTER_SLOTS,
  clockSchedule: DRAFT_CLOCK_SCHEDULE,
};
const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: SIM_INSTANT, draftOrder: TEAMS, pool: POOL, minBid: 1 };
const NEUTRAL = BOT_ARCHETYPES.find((a) => a.name === "best_available")!;

function pick(state: DraftState, teamId: string, playerId: string): DraftState {
  const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId, playerId };
  return submit(state, action);
}

/** Plays `count` picks: at each of the studied seat's turns it takes the best still-available
 *  player at the next position in `script`; every other seat drafts neutral. */
function play(state: DraftState, studied: string, script: readonly Position[], count: number): DraftState {
  let s = state;
  let scriptIndex = 0;
  for (let i = 0; i < count; i++) {
    const teamId = teamOnClock(s)!;
    if (teamId === studied) {
      const wanted = script[scriptIndex++]!;
      s = pick(s, teamId, availablePool(s).find((entry) => entry.position === wanted)!.playerId);
      continue;
    }
    s = pick(s, teamId, chooseBotPick(s, teamId, NEUTRAL, rngFor(7, `${teamId}:fixture:${s.pickNumber}`))!);
  }
  return s;
}

describe("inferSeatDriver", () => {
  it("a seat with no picks yet is the neutral prior", () => {
    const state = submit(initialDraftState(CONFIG), START);
    const driver = inferSeatDriver(state, "t05");
    expect(driver).toEqual({ kind: "archetype", archetype: NEUTRAL, basis: "prior", picksObserved: 0 });
  });

  it("stays on the prior below the minimum pick count, whatever the one pick was", () => {
    const state = play(submit(initialDraftState(CONFIG), START), "t01", ["QB"], 1);
    const driver = inferSeatDriver(state, "t01");
    expect(driver.kind).toBe("archetype");
    if (driver.kind !== "archetype") throw new Error("unreachable");
    expect(driver.basis).toBe("prior");
    expect(driver.picksObserved).toBe(1);
    expect(SEAT_MODEL_CONFIG.minPicks).toBeGreaterThan(1);
  });

  it("reads a seat that opened with two quarterbacks as the qb_early brain, from its own picks", () => {
    // t01 holds picks 1 and 24 in a 12-team snake; it takes a QB at both.
    const state = play(submit(initialDraftState(CONFIG), START), "t01", ["QB", "QB"], 24);
    const driver = inferSeatDriver(state, "t01");
    expect(driver.kind).toBe("archetype");
    if (driver.kind !== "archetype") throw new Error("unreachable");
    expect(driver.basis).toBe("inferred");
    expect(driver.archetype.name).toBe("qb_early");
    expect(driver.picksObserved).toBe(2);
  });

  it("reads a seat hammering running backs as rb_heavy", () => {
    const state = play(submit(initialDraftState(CONFIG), START), "t01", ["RB", "RB", "RB"], 25);
    const driver = inferSeatDriver(state, "t01");
    if (driver.kind !== "archetype") throw new Error("expected an archetype driver");
    expect(driver.basis).toBe("inferred");
    expect(driver.archetype.name).toBe("rb_heavy");
  });

  it("a seat whose latest pick was made by the clock is driven by the autopick policy", () => {
    let state = play(submit(initialDraftState(CONFIG), START), "t01", ["QB", "QB"], 12);
    // t12 is on the clock for pick 13 (round 2 reverses); let its clock run out.
    expect(teamOnClock(state)).toBe("t12");
    const expire: TimerExpireAction = { v: 1, type: "TIMER_EXPIRE", timestamp: "2099-01-01T00:00:00.000Z" };
    state = submit(state, expire);
    const driver = inferSeatDriver(state, "t12");
    expect(driver).toEqual({ kind: "autopick", picksObserved: 2 });
  });

  it("is deterministic: the same state infers the same drivers", () => {
    const state = play(submit(initialDraftState(CONFIG), START), "t01", ["QB", "QB", "WR"], 30);
    expect(inferSeatDrivers(state)).toEqual(inferSeatDrivers(state));
  });

  it("inferSeatDrivers names every seat in the draft order", () => {
    const state = submit(initialDraftState(CONFIG), START);
    expect(Object.keys(inferSeatDrivers(state)).sort()).toEqual([...TEAMS].sort());
  });
});
