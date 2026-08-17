import { describe, it, expect } from "vitest";
import { roundForPick, snakeTeamForPick } from "./order";

const ORDER = ["a", "b", "c", "d"];

describe("roundForPick", () => {
  it.each([
    [1, 1],
    [4, 1],
    [5, 2],
    [8, 2],
    [9, 3],
  ])("pick %i is in round %i for 4 teams", (pickNumber, expected) => {
    expect(roundForPick(ORDER.length, pickNumber)).toBe(expected);
  });
});

describe("snakeTeamForPick", () => {
  it("runs odd rounds forwards", () => {
    expect([1, 2, 3, 4].map((n) => snakeTeamForPick(ORDER, n))).toEqual(["a", "b", "c", "d"]);
  });

  it("reverses on even rounds — the team that picked last picks first", () => {
    expect([5, 6, 7, 8].map((n) => snakeTeamForPick(ORDER, n))).toEqual(["d", "c", "b", "a"]);
  });

  it("reverses back on round three", () => {
    expect([9, 10, 11, 12].map((n) => snakeTeamForPick(ORDER, n))).toEqual(["a", "b", "c", "d"]);
  });

  it("gives every team exactly the same number of picks over a full 12-team, 15-round draft", () => {
    const order = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
    const counts = new Map<string, number>();
    for (let n = 1; n <= 12 * 15; n++) {
      const team = snakeTeamForPick(order, n);
      counts.set(team, (counts.get(team) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual(Array.from({ length: 12 }, () => 15));
  });

  it("throws for a pick number outside the draft", () => {
    expect(() => snakeTeamForPick(ORDER, 0)).toThrow(/pick number/i);
  });

  it("throws when called directly with an empty draft order", () => {
    // snakeTeamForPick is part of the public engine barrel and only validates
    // pickNumber itself — an empty draftOrder is a caller error it still must
    // reject rather than silently returning undefined.
    expect(() => snakeTeamForPick([], 1)).toThrow(/invalid/i);
  });
});
