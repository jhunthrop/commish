import { describe, expect, it } from "vitest";
import { RESTING, reduceCollapse, type ExpandedSurface } from "./collapse";

describe("reduceCollapse (one overlay at a time)", () => {
  it("opens a peek from rest, and the same player again dismisses it", () => {
    const peeked = reduceCollapse(RESTING, { type: "OPEN_PEEK", playerId: "qb1" });
    expect(peeked).toEqual({ kind: "peek", playerId: "qb1" });
    expect(reduceCollapse(peeked, { type: "OPEN_PEEK", playerId: "qb1" })).toEqual(RESTING);
    expect(reduceCollapse(peeked, { type: "OPEN_PEEK", playerId: "rb1" })).toEqual({ kind: "peek", playerId: "rb1" });
  });

  it("a roster sheet replaces a peek, never stacks on it", () => {
    const peeked: ExpandedSurface = { kind: "peek", playerId: "qb1" };
    const roster = reduceCollapse(peeked, { type: "OPEN_ROSTER", teamId: "t2" });
    expect(roster).toEqual({ kind: "roster", teamId: "t2" });
    expect(reduceCollapse(roster, { type: "OPEN_ROSTER", teamId: "t2" })).toEqual(RESTING);
  });

  it("CLOSE_PEEK only closes a peek; Esc closes everything", () => {
    const roster: ExpandedSurface = { kind: "roster", teamId: "t2" };
    expect(reduceCollapse(roster, { type: "CLOSE_PEEK" })).toBe(roster);
    expect(reduceCollapse(roster, { type: "COLLAPSE_ALL" })).toEqual(RESTING);
    expect(reduceCollapse({ kind: "peek", playerId: "qb1" }, { type: "CLOSE_PEEK" })).toEqual(RESTING);
  });
});
