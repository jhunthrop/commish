import { describe, it, expect } from "vitest";
import { ADVISOR_CONFIG } from "./config";
import { baselineStartSit, tradeBalance, type StartSitCandidate, type ValuedPlayer } from "./valuation";

function player(playerId: string, averagePoints: number, position: ValuedPlayer["position"] = "RB"): ValuedPlayer {
  return { playerId, name: playerId.toUpperCase(), position, averagePoints };
}

describe("tradeBalance", () => {
  it("calls a near-equal swap even, with no flags", () => {
    const balance = tradeBalance([player("a", 12)], [player("b", 13)]);
    expect(balance.verdict).toBe("even");
    expect(balance.flags).toEqual([]);
    expect(balance.delta).toBe(-1);
  });

  it("says who a moderate gap favors, from the proposer's side", () => {
    expect(tradeBalance([player("a", 6)], [player("b", 14)]).verdict).toBe("favors_proposer");
    expect(tradeBalance([player("a", 14)], [player("b", 6)]).verdict).toBe("favors_receiver");
  });

  it("calls a gap past the lopsided threshold lopsided, and flags the gap", () => {
    const balance = tradeBalance([player("a", 2)], [player("b", 2 + ADVISOR_CONFIG.lopsidedDelta + 1)]);
    expect(balance.verdict).toBe("lopsided");
    expect(balance.flags).toContain("value_gap_over_threshold");
  });

  it("flags an empty side and refuses to call it even", () => {
    const balance = tradeBalance([], [player("b", 9)]);
    expect(balance.flags).toContain("empty_side");
    expect(balance.verdict).toBe("lopsided");
  });

  it("flags an uneven player count — the classic depth-for-a-star shape a detector must see", () => {
    const balance = tradeBalance([player("a", 5), player("b", 5), player("c", 5)], [player("d", 15)]);
    expect(balance.flags).toContain("uneven_player_count");
  });

  it("sums and rounds both sides the way the rest of the product rounds points", () => {
    const balance = tradeBalance([player("a", 10.005), player("b", 1)], [player("c", 2.5)]);
    expect(balance.givingValue).toBe(11.01);
    expect(balance.receivingValue).toBe(2.5);
    expect(balance.delta).toBe(8.51);
  });
});

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
