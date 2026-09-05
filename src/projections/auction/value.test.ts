import { describe, expect, it } from "vitest";
import { auctionValues, type AuctionValueInput } from "./value";

const SHAPE = { teamCount: 12, rosterSpots: 16, budget: 200 };

describe("auctionValues", () => {
  it("splits the surplus above the $1 floor in proportion to value over replacement", () => {
    const players: readonly AuctionValueInput[] = [
      { playerId: "a", valueOverReplacement: 100 },
      { playerId: "b", valueOverReplacement: 50 },
      { playerId: "c", valueOverReplacement: 50 },
    ];
    const values = auctionValues(players, SHAPE);
    // draftedCount = 192, totalDollars = 2400, reserve = 192, surplus = 2208. a takes half, b/c a quarter each.
    expect(values.get("a")).toBe(Math.round(1 + 2208 * 0.5));
    expect(values.get("b")).toBe(Math.round(1 + 2208 * 0.25));
    expect(values.get("c")).toBe(Math.round(1 + 2208 * 0.25));
  });

  it("floors every player at $1, never $0 or negative", () => {
    const players: readonly AuctionValueInput[] = [
      { playerId: "a", valueOverReplacement: 10 },
      { playerId: "negative", valueOverReplacement: -5 },
      { playerId: "zero", valueOverReplacement: 0 },
      { playerId: "unranked", valueOverReplacement: null },
    ];
    const values = auctionValues(players, SHAPE);
    expect(values.get("negative")).toBe(1);
    expect(values.get("zero")).toBe(1);
    expect(values.get("unranked")).toBe(1);
    expect(values.get("a")).toBeGreaterThan(1);
  });

  it("prices only the top draftedCount players from the pool, everyone else at the floor", () => {
    const shape = { teamCount: 2, rosterSpots: 2, budget: 100 }; // draftedCount = 4
    const players: readonly AuctionValueInput[] = Array.from({ length: 6 }, (_, index) => ({
      playerId: `p${index}`,
      valueOverReplacement: 60 - index * 10, // 60,50,40,30,20,10 -- top 4 get priced, bottom 2 floor
    }));
    const values = auctionValues(players, shape);
    expect(values.get("p0")).toBeGreaterThan(1);
    expect(values.get("p3")).toBeGreaterThan(1);
    expect(values.get("p4")).toBe(1);
    expect(values.get("p5")).toBe(1);
  });

  it("sums to roughly the league's total spend when the pool exactly fills every roster spot", () => {
    const shape = { teamCount: 4, rosterSpots: 3, budget: 50 }; // draftedCount = 12, totalDollars = 200
    const players: readonly AuctionValueInput[] = Array.from({ length: 12 }, (_, index) => ({
      playerId: `p${index}`,
      valueOverReplacement: 12 - index,
    }));
    const values = auctionValues(players, shape);
    const total = [...values.values()].reduce((sum, value) => sum + value, 0);
    // Whole-dollar rounding means this is close, not exact — bounded within one dollar per player.
    expect(Math.abs(total - 200)).toBeLessThanOrEqual(players.length);
  });

  it("is a pure function of its inputs — same players, same shape, same values every call", () => {
    const players: readonly AuctionValueInput[] = [
      { playerId: "a", valueOverReplacement: 30 },
      { playerId: "b", valueOverReplacement: 10 },
    ];
    expect(auctionValues(players, SHAPE)).toEqual(auctionValues(players, SHAPE));
  });

  it("throws on a non-positive team count, roster-spot count or budget", () => {
    const players: readonly AuctionValueInput[] = [{ playerId: "a", valueOverReplacement: 10 }];
    expect(() => auctionValues(players, { ...SHAPE, teamCount: 0 })).toThrow();
    expect(() => auctionValues(players, { ...SHAPE, rosterSpots: 0 })).toThrow();
    expect(() => auctionValues(players, { ...SHAPE, budget: 0 })).toThrow();
  });
});
