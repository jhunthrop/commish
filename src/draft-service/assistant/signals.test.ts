import { describe, expect, it } from "vitest";
import type { MakePickAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { availablePool, teamOnClock, type DraftState } from "@/draft-engine";
import { SIM_INSTANT, submit } from "../sim/run";
import { ADVISOR_CONFIG } from "./config";
import { detectRun } from "./signals";
import { fixtureStart } from "./test-fixture";

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
