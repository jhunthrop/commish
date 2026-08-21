import { describe, it, expect } from "vitest";
import { baselineStartSit, type StartSitCandidate } from "./valuation";

describe("baselineStartSit", () => {
  function candidate(playerId: string, averagePoints: number, starting: boolean): StartSitCandidate {
    return { playerId, name: playerId.toUpperCase(), position: "RB", slot: "RB", averagePoints, starting };
  }

  it("starts the highest scorers for as many slots as are currently started", () => {
    const baseline = baselineStartSit([candidate("a", 4, true), candidate("b", 18, false), candidate("c", 11, false)]);
    expect(baseline.start.map((p) => p.playerId)).toEqual(["b"]);
    expect(baseline.sit.map((p) => p.playerId)).toEqual(["c", "a"]);
    expect(baseline.changed).toBe(true);
  });

  it("breaks average-point ties by playerId — the same inputs always rank the same way", () => {
    const baseline = baselineStartSit([candidate("z", 9, false), candidate("m", 9, true), candidate("a", 9, false)]);
    expect(baseline.start.map((p) => p.playerId)).toEqual(["a"]);
    expect(baseline.sit.map((p) => p.playerId)).toEqual(["m", "z"]);
  });

  it("says nothing needs to change when the best players are already starting", () => {
    const baseline = baselineStartSit([candidate("a", 18, true), candidate("b", 4, false)]);
    expect(baseline.start.map((p) => p.playerId)).toEqual(["a"]);
    expect(baseline.changed).toBe(false);
  });

  it("handles a group with nobody currently starting", () => {
    const baseline = baselineStartSit([candidate("a", 4, false), candidate("b", 8, false)]);
    expect(baseline.start).toEqual([]);
    expect(baseline.sit.map((p) => p.playerId)).toEqual(["b", "a"]);
    expect(baseline.changed).toBe(false);
  });
});
