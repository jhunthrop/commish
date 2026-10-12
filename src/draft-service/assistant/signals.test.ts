import { describe, expect, it } from "vitest";
import type { MakePickAction } from "@research-ts/domain/draft";
import type { Position } from "@research-ts/domain/player";
import { availablePool, teamOnClock, type DraftState } from "@/draft-engine";
import { SIM_INSTANT, submit } from "../sim/run";
import { draftedPlayerIds } from "@/draft-engine";
import { isRealTierCliff, tierStanding } from "@research-ts/projections/decide/tiers";
import { ADVISOR_CONFIG } from "./config";
import { detectRun, tierCollapses } from "./signals";
import { fixtureStart, fixtureValued } from "./test-fixture";

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
  it("lists at most one row per projected position, only where the best man left sits at a real cliff, tightest first", () => {
    const state = playPositions(["RB", "RB", "WR", "QB", "TE"]);
    const valued = fixtureValued();
    const rows = tierCollapses(state, valued);
    const drafted = draftedPlayerIds(state);
    expect(new Set(rows.map((row) => row.position)).size).toBe(rows.length);
    for (const row of rows) {
      expect(["QB", "RB", "WR", "TE"]).toContain(row.position);
      const left = [...valued.values()]
        .filter((entry) => entry.position === row.position && !drafted.has(entry.playerId))
        .sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId));
      const standing = tierStanding(left.map((entry) => entry.projectedPoints), 0);
      expect(isRealTierCliff(left[0]!.projectedPoints, standing.dropToNextTier)).toBe(true);
      expect(row).toEqual({ position: row.position, playersLeftInTier: standing.playersLeftInTier, dropToNextTier: standing.dropToNextTier });
    }
    const keys = rows.map((row) => [row.playersLeftInTier, -row.dropToNextTier] as const);
    expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  });

  it("never lists a position the board ships in market order", () => {
    for (const row of tierCollapses(fixtureStart(), fixtureValued())) expect(["K", "DEF"]).not.toContain(row.position);
  });
});
