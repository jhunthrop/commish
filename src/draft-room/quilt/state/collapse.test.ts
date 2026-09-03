import { describe, expect, it } from "vitest";
import { RESTING, reduceCollapse, type CollapseEvent, type ExpandedSurface } from "./collapse";

function run(state: ExpandedSurface, ...events: readonly CollapseEvent[]): ExpandedSurface {
  return events.reduce(reduceCollapse, state);
}

describe("reduceCollapse", () => {
  it("space walks none → half → none, and steps full back to half", () => {
    const half = run(RESTING, { type: "TOGGLE_DRAWER" });
    expect(half).toEqual({ kind: "drawer", height: "half", tab: "pool" });
    expect(run(half, { type: "TOGGLE_DRAWER" })).toEqual(RESTING);
    const full = run(half, { type: "SET_HEIGHT", height: "full" });
    expect(run(full, { type: "TOGGLE_DRAWER" })).toEqual({ kind: "drawer", height: "half", tab: "pool" });
  });

  it("slash opens search: the drawer at full, on the pool tab, from anywhere", () => {
    for (const from of [RESTING, run(RESTING, { type: "TOGGLE_SPINE" }), run(RESTING, { type: "OPEN_PEEK", playerId: "p1" })]) {
      expect(run(from, { type: "OPEN_SEARCH" })).toEqual({ kind: "drawer", height: "full", tab: "pool" });
    }
  });

  it("one expanded surface at a time: opening the peek closes the drawer, and vice versa", () => {
    const drawer = run(RESTING, { type: "TOGGLE_DRAWER" });
    const peek = run(drawer, { type: "OPEN_PEEK", playerId: "p1" });
    expect(peek).toEqual({ kind: "peek", playerId: "p1" });
    expect(run(peek, { type: "TOGGLE_DRAWER" })).toEqual({ kind: "drawer", height: "half", tab: "pool" });
  });

  it("peeking the peeked player again dismisses; peeking another swaps", () => {
    const peek = run(RESTING, { type: "OPEN_PEEK", playerId: "p1" });
    expect(run(peek, { type: "OPEN_PEEK", playerId: "p1" })).toEqual(RESTING);
    expect(run(peek, { type: "OPEN_PEEK", playerId: "p2" })).toEqual({ kind: "peek", playerId: "p2" });
    expect(run(peek, { type: "CLOSE_PEEK" })).toEqual(RESTING);
  });

  it("the spine toggles, and yields to any other surface", () => {
    const spine = run(RESTING, { type: "TOGGLE_SPINE" });
    expect(spine).toEqual({ kind: "spine" });
    expect(run(spine, { type: "TOGGLE_SPINE" })).toEqual(RESTING);
    expect(run(spine, { type: "TOGGLE_DRAWER" })).toEqual({ kind: "drawer", height: "half", tab: "pool" });
  });

  it("a tab names the drawer: from rest it opens the drawer at that tab", () => {
    expect(run(RESTING, { type: "SET_TAB", tab: "byes" })).toEqual({ kind: "drawer", height: "half", tab: "byes" });
    const full = run(RESTING, { type: "OPEN_SEARCH" });
    expect(run(full, { type: "SET_TAB", tab: "sheet" })).toEqual({ kind: "drawer", height: "full", tab: "sheet" });
  });

  it("esc collapses everything from every surface", () => {
    const surfaces: readonly ExpandedSurface[] = [
      RESTING,
      run(RESTING, { type: "TOGGLE_DRAWER" }),
      run(RESTING, { type: "OPEN_SEARCH" }),
      run(RESTING, { type: "OPEN_PEEK", playerId: "p9" }),
      run(RESTING, { type: "TOGGLE_SPINE" }),
    ];
    for (const surface of surfaces) expect(run(surface, { type: "COLLAPSE_ALL" })).toEqual(RESTING);
  });
});
