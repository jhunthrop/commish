import { describe, expect, it } from "vitest";
import { absorptionWeights, redistributeShares, REDISTRIBUTION_CONFIG, type RosterPlayer } from "./redistribution";

/**
 * THE SPECIFICATION IS A REAL TRADE.
 *
 * On 15 October 2024 Cleveland traded Amari Cooper to Buffalo, four days before week 7. Cooper had
 * been the Browns' number-one receiver and left roughly a fifth of their targets behind. Jerry
 * Jeudy — the number two, on nearly every snap — absorbed most of them and finished the season with
 * ninety catches, comfortably a career high. Cedric Tillman, a rotational third receiver at the
 * time, absorbed a real but smaller share, and David Njoku at tight end some of the rest.
 *
 * The test is that specification: given the roster as it stood and the share Cooper vacated, the
 * feature must put most of it on Jeudy, some on Tillman, less on Njoku, and next to none on the
 * running back. Shares below are the real ones, rounded — Cooper was at 21% of Cleveland's targets
 * over the six weeks before the trade.
 */
const CLEVELAND: readonly RosterPlayer[] = [
  { playerId: "jeudy", position: "WR", snapShare: 0.9, upliftWhenAbsent: null },
  { playerId: "tillman", position: "WR", snapShare: 0.45, upliftWhenAbsent: null },
  { playerId: "njoku", position: "TE", snapShare: 0.75, upliftWhenAbsent: null },
  { playerId: "ford", position: "RB", snapShare: 0.5, upliftWhenAbsent: null },
];

const COOPER = { playerId: "cooper", position: "WR" as const, targetShare: 0.21, carryShare: 0 };

describe("the Amari Cooper trade, week 7 of 2024", () => {
  const deltas = redistributeShares({
    roster: CLEVELAND,
    departures: [COOPER],
    arrivals: [],
    absorptionRate: 0.8,
  });

  it("gives the largest share of the vacated targets to the number two receiver", () => {
    const jeudy = deltas.get("jeudy")!.targetShare;
    for (const other of ["tillman", "njoku", "ford"]) {
      expect(jeudy).toBeGreaterThan(deltas.get(other)!.targetShare);
    }
  });

  it("orders the rest by role proximity — the other receiver, then the tight end, then the back", () => {
    expect(deltas.get("tillman")!.targetShare).toBeGreaterThan(deltas.get("njoku")!.targetShare);
    expect(deltas.get("njoku")!.targetShare).toBeGreaterThan(deltas.get("ford")!.targetShare);
  });

  it("moves Jeudy's target share by several points, not by a rounding error", () => {
    // The whole value of the feature is that it says this in week 7 rather than in week 10, so the
    // size has to be large enough to matter to a ranking.
    expect(deltas.get("jeudy")!.targetShare).toBeGreaterThan(0.05);
  });

  it("absorbs less than the whole vacated share, because an offence that loses its best receiver throws less", () => {
    const absorbed = [...deltas.values()].reduce((sum, delta) => sum + delta.targetShare, 0);
    expect(absorbed).toBeLessThan(COOPER.targetShare);
    expect(absorbed).toBeCloseTo(0.8 * COOPER.targetShare, 6);
  });

  it("does not move anybody's carry share, because a receiver vacates no carries", () => {
    expect([...deltas.values()].every((delta) => delta.carryShare === 0)).toBe(true);
  });
});

describe("absorptionWeights", () => {
  it("prefers what actually happened when the departing player sat over the depth chart", () => {
    // Direct evidence outranks inference. If the third receiver is the one who really absorbed the
    // work in the two games the starter missed, that beats his snap count saying otherwise.
    const roster: readonly RosterPlayer[] = [
      { playerId: "high-snaps", position: "WR", snapShare: 0.95, upliftWhenAbsent: 0.01 },
      { playerId: "really-absorbed", position: "WR", snapShare: 0.3, upliftWhenAbsent: 0.09 },
    ];
    const weights = absorptionWeights(roster, "WR");
    expect(weights.get("really-absorbed")!).toBeGreaterThan(weights.get("high-snaps")!);
  });

  it("falls back to affinity times snap share when nobody ever missed a game with him out", () => {
    const weights = absorptionWeights(CLEVELAND, "WR");
    expect(weights.get("jeudy")!).toBeGreaterThan(weights.get("tillman")!);
  });

  it("sums to one, so a vacated share is neither invented nor lost", () => {
    const total = [...absorptionWeights(CLEVELAND, "WR").values()].reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("gives a quarterback's vacated targets to nobody, rather than spreading a nonsense", () => {
    expect(absorptionWeights(CLEVELAND, "QB").size).toBe(0);
  });

  it("sends a back's vacated carries to the backs", () => {
    const weights = absorptionWeights(CLEVELAND, "RB");
    expect(weights.get("ford")!).toBeGreaterThan(weights.get("jeudy")!);
  });
});

describe("redistributeShares — the reverse case and the bounds", () => {
  it("compresses everyone else when a number one ARRIVES", () => {
    const deltas = redistributeShares({
      roster: CLEVELAND,
      departures: [],
      arrivals: [{ playerId: "newcomer", position: "WR", targetShare: 0.24, carryShare: 0 }],
      absorptionRate: 0.8,
    });
    expect(deltas.get("jeudy")!.targetShare).toBeLessThan(0);
    // And it comes off the people who would have absorbed a departure, in the same order.
    expect(deltas.get("jeudy")!.targetShare).toBeLessThan(deltas.get("ford")!.targetShare);
  });

  it("nets a departure against an arrival rather than moving the same players twice", () => {
    const netted = redistributeShares({
      roster: CLEVELAND,
      departures: [COOPER],
      arrivals: [{ playerId: "newcomer", position: "WR", targetShare: 0.21, carryShare: 0 }],
      absorptionRate: 0.8,
    });
    // A team that lost one receiver and signed an identical one has not changed.
    expect(netted.get("jeudy")!.targetShare).toBeCloseTo(0, 10);
  });

  it("refuses to move one player's share further than any real transaction ever does", () => {
    const deltas = redistributeShares({
      roster: [{ playerId: "only-one-left", position: "WR", snapShare: 0.9, upliftWhenAbsent: null }],
      departures: [{ playerId: "everybody", position: "WR", targetShare: 0.6, carryShare: 0 }],
      arrivals: [],
      absorptionRate: 1,
    });
    expect(deltas.get("only-one-left")!.targetShare).toBeCloseTo(REDISTRIBUTION_CONFIG.maxShareMove, 10);
  });

  it("moves nobody when nothing happened", () => {
    const deltas = redistributeShares({ roster: CLEVELAND, departures: [], arrivals: [], absorptionRate: 0.8 });
    expect([...deltas.values()].every((delta) => delta.targetShare === 0 && delta.carryShare === 0)).toBe(true);
  });
});
