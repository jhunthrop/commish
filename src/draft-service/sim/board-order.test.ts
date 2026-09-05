import { describe, expect, it } from "vitest";
import { createSeededRng } from "@/mock-draft/rng";
import { simBoardOrder, type SimRankableEntry } from "./board-order";

const POOL: readonly SimRankableEntry[] = [
  { playerId: "a", position: "RB", evidenceRank: 0, marketRank: 2 },
  { playerId: "b", position: "WR", evidenceRank: 1, marketRank: 0 },
  { playerId: "c", position: "WR", evidenceRank: 2, marketRank: 1 },
  { playerId: "d", position: "TE", evidenceRank: 3, marketRank: null },
];

describe("simBoardOrder", () => {
  it("at full sharpness (1), with jitter zeroed by a deterministic rng, reproduces the evidence order exactly", () => {
    const zeroRng = { next: () => 0.5 }; // (0.5 - 0.5) * 2 * spread === 0 for any spread
    const order = simBoardOrder(POOL, 1, zeroRng);
    expect(order.map((e) => e.playerId)).toEqual(["a", "b", "c", "d"]);
  });

  it("at zero sharpness (0), with jitter zeroed, reproduces the market order exactly for ranked players", () => {
    const zeroRng = { next: () => 0.5 };
    const order = simBoardOrder(POOL, 0, zeroRng);
    // Market order: b(0), c(1), a(2), then d — unranked by market, anchored to his own
    // evidence rank (3), which keeps him last here regardless.
    expect(order.map((e) => e.playerId)).toEqual(["b", "c", "a", "d"]);
  });

  it("is a pure function of its inputs: the same seed reproduces the identical order", () => {
    const orderA = simBoardOrder(POOL, 0.5, createSeededRng(42));
    const orderB = simBoardOrder(POOL, 0.5, createSeededRng(42));
    expect(orderA).toEqual(orderB);
  });

  it("two different seeds can produce different orders at casual sharpness", () => {
    const orderA = simBoardOrder(POOL, 0, createSeededRng(1));
    const orderB = simBoardOrder(POOL, 0, createSeededRng(2));
    // Not asserted to always differ (a coincidence is possible with only 4 players), but across
    // these two fixed seeds the jitter is known to produce different orderings.
    expect(orderA.map((e) => e.playerId)).not.toEqual(orderB.map((e) => e.playerId));
  });

  it("carries every input player through exactly once, position included", () => {
    const order = simBoardOrder(POOL, 0.5, createSeededRng(7));
    expect(order).toHaveLength(POOL.length);
    expect(new Set(order.map((e) => e.playerId)).size).toBe(POOL.length);
    for (const entry of order) {
      const source = POOL.find((p) => p.playerId === entry.playerId)!;
      expect(entry.position).toBe(source.position);
    }
  });
});
