import { describe, expect, it } from "vitest";
import type { Position } from "@research/domain/player";
import { BENCH_SLOT, type RosterSlotConfig } from "@research/domain/roster";
import { valueBoardIndexed } from "@research/projections/decide/replacement";
import type { SimPlayerEvidence } from "./types";
import { valueOrderFor } from "./value-order";

/** Two teams, one started quarterback, two started backs, a bench that may hold a kicker the
 *  league never STARTS — the smallest shape that exercises every branch: a shallow position
 *  (QB) whose replacement level sits right under its best player, a deep one (RB) whose
 *  replacement level sits far below, and a position with no starting slot at all. */
const SHAPE = {
  teamCount: 2,
  rosterSlots: [
    { slot: "QB", count: 1, eligiblePositions: ["QB"] },
    { slot: "RB", count: 2, eligiblePositions: ["RB"] },
    { slot: BENCH_SLOT, count: 2, eligiblePositions: ["QB", "RB", "K"] },
  ] as readonly RosterSlotConfig[],
};

function entry(playerId: string, position: Position, projectedPoints: number): SimPlayerEvidence {
  return { playerId, position, marketRank: null, projectedPoints };
}

/** Quarterbacks carry the highest RAW points here, exactly as they do on the real board. */
const POOL: readonly SimPlayerEvidence[] = [
  entry("qb1", "QB", 300),
  entry("qb2", "QB", 290),
  entry("qb3", "QB", 280),
  entry("rb1", "RB", 200),
  entry("rb2", "RB", 150),
  entry("rb3", "RB", 100),
  entry("rb4", "RB", 50),
  entry("k1", "K", 10),
  entry("k2", "K", 5),
];

describe("valueOrderFor", () => {
  it("orders the started positions exactly as valueBoardIndexed does, never by raw points", () => {
    const expected = valueBoardIndexed(
      POOL.map(({ playerId, position, projectedPoints }) => ({ playerId, position, projectedPoints })),
      SHAPE,
    ).sorted.map((valued) => valued.playerId);
    const actual = valueOrderFor(POOL, SHAPE).map((e) => e.playerId);
    expect(actual.slice(0, expected.length)).toEqual(expected);
  });

  it("does not crown the highest-scoring quarterback in a league that starts one of them", () => {
    const order = valueOrderFor(POOL, SHAPE);
    expect(order[0]!.playerId).toBe("rb1");
    expect(order.findIndex((e) => e.playerId === "qb1")).toBeGreaterThan(2);
  });

  it("sinks a position the shape never starts below every valued player, best points first", () => {
    const order = valueOrderFor(POOL, SHAPE).map((e) => e.playerId);
    expect(order.slice(-2)).toEqual(["k1", "k2"]);
  });

  it("carries every input player through exactly once", () => {
    const order = valueOrderFor(POOL, SHAPE);
    expect(order).toHaveLength(POOL.length);
    expect(new Set(order.map((e) => e.playerId)).size).toBe(POOL.length);
  });
});
