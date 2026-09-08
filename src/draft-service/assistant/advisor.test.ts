import { describe, expect, it } from "vitest";
import { pickLabel } from "@/domain/pick-label";
import { availablePool, teamOnClock } from "@/draft-engine";
import { simulateRoomOdds } from "../sim/room-odds";
import { inferSeatDrivers } from "../sim/seat-model";
import { advisorCore, seedFor } from "./advisor";
import { SURVIVAL_BANDS } from "@/domain/draft-odds";
import { onClockShortlist, recommendNow } from "./recommend";
import { FIXTURE_SHAPE, FIXTURE_TEAM_IDS, fixtureAdvance, fixtureStart, fixtureValued } from "./test-fixture";
import { tierStandings } from "./tiers";
import type { AdvisorView } from "./view";

const ASKING = FIXTURE_TEAM_IDS[3]!; // seat 4 of 10: picks 4, 17, 24, 37, ...
const RUNS = 30;
const BANNED_PUNCTUATION = /[—;]/;

function viewAfter(picks: number, askingTeamId = ASKING): AdvisorView {
  const state = fixtureAdvance(fixtureStart(), picks);
  const valued = fixtureValued();
  const table = simulateRoomOdds({ state, seed: seedFor("advisor-test", state.sequence), runs: RUNS, drivers: inferSeatDrivers(state), excludeFromOnClockSeat: onClockShortlist(state, valued, FIXTURE_SHAPE) });
  const view = advisorCore({ state, askingTeamId, valued, shape: FIXTURE_SHAPE, table, tiers: tierStandings(state, valued) });
  if (view === null) throw new Error("expected a view");
  return view;
}

describe("advisorCore", () => {
  it("stamps the view with the pick and sequence it was computed at, and says whether you are on the clock", () => {
    const state = fixtureAdvance(fixtureStart(), 3);
    expect(teamOnClock(state)).toBe(ASKING);
    const view = viewAfter(3);
    expect(view.onTheClock).toBe(true);
    expect(view.picksUntilYourTurn).toBe(0);
    expect(view.pickNumber).toBe(4);
    expect(view.stamp).toEqual({ computedAtPick: 4, sequence: state.sequence });
    expect(view.teamCount).toBe(10);
    expect(view.runs).toBe(RUNS);
    expect(pickLabel(view.stamp.computedAtPick, view.teamCount)).toBe("1.04");
  });

  it("counts the picks until your turn when you are not on the clock, and measures the odds at that turn", () => {
    const view = viewAfter(12); // pick 13 is up; seat 4 next at 17
    expect(view.onTheClock).toBe(false);
    expect(view.pickNumber).toBe(17);
    expect(view.picksUntilYourTurn).toBe(4);
    expect(view.odds!.pickNumber).toBe(17);
  });

  it("measures the on-clock seat's odds at the turn AFTER its current pick", () => {
    const view = viewAfter(3);
    expect(view.odds!.pickNumber).toBe(17);
    expect(view.pick!.makeItBack!.runs).toBe(RUNS);
  });

  it("names one pick with a slot, a rank, odds as runs over runs, and a why of at most two sentences", () => {
    for (const picks of [3, 12, 30]) {
      const view = viewAfter(picks);
      const pick = view.pick!;
      expect(pick.fillsSlot).not.toBeNull();
      expect(pick.positionRank).toBeGreaterThan(0);
      expect(pick.makeItBack!.runs).toBe(RUNS);
      expect(pick.makeItBack!.survival).toBeGreaterThanOrEqual(0);
      expect(pick.makeItBack!.survival).toBeLessThanOrEqual(1);
      expect(pick.why.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2);
      expect(pick.why).not.toMatch(BANNED_PUNCTUATION);
      expect(pick.why).not.toMatch(/tier [A-Z]\b|prior|infer|last man|one of 1\b/i);
      expect(pick.why).toMatch(/in our 30 runs|Nobody picks/);
    }
  });

  it("rotates the why's shape across consecutive turns of the same family", () => {
    const shapes = [3, 4, 5].map((picks) => viewAfter(picks, FIXTURE_TEAM_IDS[0]!).pick!.whyShape);
    const families = new Set(shapes.map((shape) => shape.split(":")[0]));
    if (families.size === 1) expect(new Set(shapes).size).toBe(shapes.length);
    for (const shape of shapes) expect(shape).toMatch(/^(cliff|value):[0-2]$/);
  });

  it("carries next-turn odds for every undrafted player and a tier standing for every projected one, none for kickers or defenses", () => {
    const state = fixtureAdvance(fixtureStart(), 12);
    const view = viewAfter(12);
    const undrafted = availablePool(state).map((entry) => entry.playerId);
    expect(Object.keys(view.odds!.survived).sort()).toEqual([...undrafted].sort());
    for (const count of Object.values(view.odds!.survived)) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(view.odds!.runs);
    }
    expect(view.odds!.survived[view.pick!.playerId]! / view.odds!.runs).toBe(view.pick!.makeItBack!.survival);
    for (const id of undrafted) {
      const standing = view.tiers[id];
      if (id.startsWith("k") || id.startsWith("def")) expect(standing).toBeUndefined();
      else {
        expect(standing!.tier).toBeGreaterThan(0);
        expect(standing!.left).toBeGreaterThan(0);
        expect(standing!.left).toBeLessThanOrEqual(standing!.size);
      }
    }
  });

  it("off the clock, names the first shortlisted player the runs leave on the board past the reach floor", () => {
    const state = fixtureAdvance(fixtureStart(), 4); // seat 4 just picked; its next turn is 17
    const valued = fixtureValued();
    const table = simulateRoomOdds({ state, seed: seedFor("advisor-test", state.sequence), runs: RUNS, drivers: inferSeatDrivers(state), excludeFromOnClockSeat: onClockShortlist(state, valued, FIXTURE_SHAPE) });
    const view = advisorCore({ state, askingTeamId: ASKING, valued, shape: FIXTURE_SHAPE, table, tiers: tierStandings(state, valued) })!;
    const shortlist = recommendNow({ state, askingTeamId: ASKING, valued, shape: FIXTURE_SHAPE });
    const survivalOf = (id: string) => (view.odds!.survived[id] ?? 0) / view.odds!.runs;
    const reachable = shortlist.find((rec) => survivalOf(rec.playerId) >= SURVIVAL_BANDS.reach);
    expect(view.onTheClock).toBe(false);
    expect(view.pick!.playerId).toBe((reachable ?? shortlist[0])!.playerId);

    // A hand-built table in which every run's other seats take the shortlist's first man at
    // pick 5 and nobody touches the second: the card moves down to the second.
    const filler = availablePool(state)
      .map((entry) => entry.playerId)
      .filter((id) => !shortlist.some((rec) => rec.playerId === id))
      .slice(0, 11);
    const run = [shortlist[0]!.playerId, ...filler].map((playerId, index) => ({ pickNumber: 5 + index, teamId: FIXTURE_TEAM_IDS[9]!, playerId }));
    const handBuilt = { runs: 4, fromPick: 5, throughPick: 16, played: [run, run, run, run] };
    const moved = advisorCore({ state, askingTeamId: ASKING, valued, shape: FIXTURE_SHAPE, table: handBuilt, tiers: {} })!;
    expect(moved.pick!.playerId).toBe(shortlist[1]!.playerId);
    expect(moved.odds!.survived[shortlist[0]!.playerId]).toBe(0);
    expect(moved.pick!.makeItBack).toEqual({ survival: 1, runs: 4 });
  });

  it("is reproducible for the same room state, and moves with the room on a new pick", () => {
    expect(viewAfter(12)).toEqual(viewAfter(12));
    const a = viewAfter(12);
    const b = viewAfter(13);
    expect(b.stamp.sequence).toBeGreaterThan(a.stamp.sequence);
    expect(b.stamp.computedAtPick).toBe(a.stamp.computedAtPick + 1);
    expect(b.picksUntilYourTurn).toBe(a.picksUntilYourTurn - 1);
  });

  it("has no odds at the seat's last turn, and is null once the seat has no turn left", () => {
    const state = fixtureAdvance(fixtureStart(), 149); // pick 150 of 150 is up; seat 4 finished earlier
    const valued = fixtureValued();
    const table = simulateRoomOdds({ state, seed: 1, runs: 5, excludeFromOnClockSeat: new Set() });
    const tiers = tierStandings(state, valued);
    expect(advisorCore({ state, askingTeamId: ASKING, valued, shape: FIXTURE_SHAPE, table, tiers })).toBeNull();
    const last = advisorCore({ state, askingTeamId: teamOnClock(state)!, valued, shape: FIXTURE_SHAPE, table, tiers });
    expect(last!.odds).toBeNull();
    expect(last!.pick === null || last!.pick.makeItBack === null).toBe(true);
  });
});
