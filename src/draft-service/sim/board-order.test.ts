import { describe, expect, it } from "vitest";
import { createSeededRng } from "@/mock-draft/rng";
import { simBoardOrder, type SimRankableEntry } from "./board-order";

const POOL: readonly SimRankableEntry[] = [
  { playerId: "a", position: "RB", evidenceRank: 0, marketRank: 2 },
  { playerId: "b", position: "WR", evidenceRank: 1, marketRank: 0 },
  { playerId: "c", position: "WR", evidenceRank: 2, marketRank: 1 },
  { playerId: "d", position: "TE", evidenceRank: 3, marketRank: null },
];

/** `(0.5 - 0.5) * 2 * spread === 0` for any spread: the market order, undisturbed. */
const zeroRng = { next: () => 0.5 };

describe("simBoardOrder", () => {
  it("drafts the market's order at every sharpness once jitter is zeroed", () => {
    for (const sharpness of [0, 0.5, 1]) {
      expect(simBoardOrder(POOL, sharpness, zeroRng).map((e) => e.playerId)).toEqual(["b", "c", "a", "d"]);
    }
  });

  it("ignores our board entirely for players the market ranks", () => {
    // Same ADP, evidence order reversed: the room's board must not move a single position.
    const reversed: readonly SimRankableEntry[] = POOL.map((entry) => ({ ...entry, evidenceRank: POOL.length - 1 - entry.evidenceRank }));
    const asIs = simBoardOrder(POOL.filter((e) => e.marketRank !== null), 0, createSeededRng(11));
    const flipped = simBoardOrder(reversed.filter((e) => e.marketRank !== null), 0, createSeededRng(11));
    expect(flipped.map((e) => e.playerId)).toEqual(asIs.map((e) => e.playerId));
  });

  it("puts every player the market never ranked after every player it did, in our board's order among themselves", () => {
    const deepBench: readonly SimRankableEntry[] = [
      { playerId: "a", position: "RB", evidenceRank: 0, marketRank: 0 },
      { playerId: "b", position: "WR", evidenceRank: 1, marketRank: 1 },
      { playerId: "y", position: "TE", evidenceRank: 2, marketRank: null },
      { playerId: "x", position: "K", evidenceRank: 3, marketRank: null },
    ];
    // Casual sharpness, real jitter: the unranked block still never jumps the ranked one.
    const order = simBoardOrder(deepBench, 0, createSeededRng(3)).map((e) => e.playerId);
    expect(new Set(order.slice(0, 2))).toEqual(new Set(["a", "b"]));
    expect(order.slice(2)).toEqual(["y", "x"]);
  });

  it("is a pure function of its inputs: the same seed reproduces the identical order", () => {
    const orderA = simBoardOrder(POOL, 0.5, createSeededRng(42));
    const orderB = simBoardOrder(POOL, 0.5, createSeededRng(42));
    expect(orderA).toEqual(orderB);
  });

  it("two different seeds can produce different orders at casual sharpness", () => {
    const orderA = simBoardOrder(POOL, 0, createSeededRng(1));
    const orderB = simBoardOrder(POOL, 0, createSeededRng(8));
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
