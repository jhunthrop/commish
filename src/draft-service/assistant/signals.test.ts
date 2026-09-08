import { describe, expect, it } from "vitest";
import type { MakePickAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { availablePool, teamOnClock, type DraftState } from "@/draft-engine";
import { isRealTierCliff, tierStanding } from "@/projections/decide/tiers";
import { shipsProjectedRows } from "@/projections/preseason/kdef-decision";
import { horizonOdds } from "../sim/horizon-odds";
import { SIM_INSTANT, submit } from "../sim/run";
import { inferSeatDrivers } from "../sim/seat-model";
import { ADVISOR_CONFIG } from "./config";
import { detectRun, roomSignals, seatsAhead, tierCollapses } from "./signals";
import { FIXTURE_POOL, FIXTURE_TEAM_IDS, fixtureAdvance, fixtureStart, fixtureValued } from "./test-fixture";

const ASKING = FIXTURE_TEAM_IDS[3]!;

/** Plays `positions` in order from the fresh room, each seat taking the best at that position. */
function playPositions(positions: readonly Position[]): DraftState {
  let state = fixtureStart();
  for (const position of positions) {
    const teamId = teamOnClock(state)!;
    const playerId = availablePool(state).find((entry) => entry.position === position)!.playerId;
    const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId, playerId };
    state = submit(state, action);
  }
  return state;
}

describe("detectRun", () => {
  it("fires when three of the last four picks share a position", () => {
    const state = playPositions(["WR", "RB", "QB", "RB", "RB"]);
    expect(detectRun(state)).toEqual({ position: "RB", count: 3, window: 4 });
    expect(ADVISOR_CONFIG.signals.runThreshold).toBe(3);
    expect(ADVISOR_CONFIG.signals.runWindow).toBe(4);
  });

  it("stays quiet at two of four, and before any pick", () => {
    expect(detectRun(playPositions(["RB", "WR", "RB", "QB"]))).toBeNull();
    expect(detectRun(fixtureStart())).toBeNull();
  });

  it("judges only the most recent window", () => {
    expect(detectRun(playPositions(["RB", "RB", "RB", "WR", "QB", "TE"]))).toBeNull();
  });
});

describe("tierCollapses", () => {
  it("never names a collapse for a position the board ships in market order, even when the fixture carries points for it", () => {
    const valued = fixtureValued();
    const marketOrder = [...valued.values()].filter((entry) => !shipsProjectedRows(entry.position));
    expect(marketOrder.length).toBeGreaterThan(0); // the synthetic fixture carries K and DEF rows a real store never would
    for (const row of tierCollapses(fixtureStart(), valued)) expect(shipsProjectedRows(row.position)).toBe(true);
    expect(tierCollapses(fixtureStart(), valued).some((row) => row.position === "K" || row.position === "DEF")).toBe(false);
  });

  it("names each position whose best undrafted player is at a real cliff, with the board's own drop and the tier letter", () => {
    const state = fixtureAdvance(fixtureStart(), 9);
    const valued = fixtureValued();
    const rows = tierCollapses(state, valued);
    const drafted = new Set(state.picks.map((pick) => pick.playerId));
    for (const row of rows) {
      const undrafted = FIXTURE_POOL.filter((entry) => entry.position === row.position && !drafted.has(entry.playerId)).sort((a, b) => b.projectedPoints - a.projectedPoints);
      const standing = tierStanding(undrafted.map((entry) => entry.projectedPoints), 0);
      expect(row.dropToNextTier).toBe(standing.dropToNextTier);
      expect(row.playersLeftInTier).toBe(standing.playersLeftInTier);
      expect(isRealTierCliff(undrafted[0]!.projectedPoints, row.dropToNextTier)).toBe(true);
      expect(row.tierLabel).toBe("A");
    }
    // Every projected position NOT listed is honestly not at a cliff for its best remaining player.
    const listed = new Set(rows.map((row) => row.position));
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      if (listed.has(position) || !shipsProjectedRows(position)) continue;
      const undrafted = FIXTURE_POOL.filter((entry) => entry.position === position && !drafted.has(entry.playerId)).sort((a, b) => b.projectedPoints - a.projectedPoints);
      const standing = tierStanding(undrafted.map((entry) => entry.projectedPoints), 0);
      expect(isRealTierCliff(undrafted[0]!.projectedPoints, standing.dropToNextTier)).toBe(false);
    }
  });
});

describe("seatsAhead", () => {
  it("reads each seat between now and your next turn from the runs, with its driver's basis", () => {
    const state = fixtureAdvance(fixtureStart(), 12); // pick 13 is up; seat 4 next at pick 17
    const drivers = inferSeatDrivers(state);
    const odds = horizonOdds({ state, askingTeamId: ASKING, targetIds: ["rb6"], seed: 2, runs: 20, horizon: 1, drivers });
    const rows = seatsAhead(state, odds, drivers);
    expect(rows.map((row) => row.pickNumber)).toEqual([13, 14, 15, 16]);
    expect(rows.map((row) => row.seat)).toEqual([8, 7, 6, 5]);
    for (const row of rows) {
      expect(row.runs).toBe(20);
      expect(row.topPosition).not.toBeNull();
      expect(row.topPlayer).not.toBeNull();
      expect(row.driver.kind).toBe("archetype");
      expect(row.driver.picksObserved).toBe(1);
      if (row.driver.kind === "archetype") expect(row.driver.basis).toBe("prior");
    }
  });
});

describe("roomSignals", () => {
  it("assembles the three reads", () => {
    const state = fixtureAdvance(fixtureStart(), 12);
    const drivers = inferSeatDrivers(state);
    const odds = horizonOdds({ state, askingTeamId: ASKING, targetIds: ["rb6"], seed: 2, runs: 10, horizon: 1, drivers });
    const signals = roomSignals({ state, valued: fixtureValued(), odds, drivers });
    expect(signals.ahead).toHaveLength(4);
    expect(Array.isArray(signals.collapses)).toBe(true);
    expect(signals.run === null || signals.run.count >= ADVISOR_CONFIG.signals.runThreshold).toBe(true);
  });
});
