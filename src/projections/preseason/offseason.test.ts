import { describe, expect, it } from "vitest";
import type { RosterPlayer } from "../features/redistribution";
import { changedSituationSegment, isTransaction, offseasonDeltas, type OffseasonMove } from "./offseason";

/**
 * These are the plan's own three cases, written against real shapes rather than real names: a
 * receiver whose team lost its primary target should project a larger share, a back who signed
 * somewhere with an entrenched starter should project a smaller one, and a man who did not move
 * should be untouched.
 *
 * The absorption rate used here is the fitted one's order of magnitude. The exact value belongs to
 * `model/fitted.ts` and is deliberately not asserted: this module composes somebody else's
 * arithmetic, so a test pinning their constant would fail when they re-fit and would tell nobody
 * anything about this file.
 */
const ABSORPTION = 0.065;

function roster(...players: readonly { id: string; position: RosterPlayer["position"]; snapShare: number }[]): readonly RosterPlayer[] {
  return players.map((player) => ({
    playerId: player.id,
    position: player.position,
    snapShare: player.snapShare,
    upliftWhenAbsent: null,
  }));
}

describe("isTransaction", () => {
  it("is a change of employer, and staying put is not one", () => {
    const base = { playerId: "a", position: "WR" as const, targetShare: 0.2, carryShare: 0 };
    expect(isTransaction({ ...base, from: "CLE", to: "BUF" })).toBe(true);
    expect(isTransaction({ ...base, from: "CLE", to: null })).toBe(true);
    expect(isTransaction({ ...base, from: null, to: "BUF" })).toBe(true);
    expect(isTransaction({ ...base, from: "CLE", to: "CLE" })).toBe(false);
  });
});

describe("offseasonDeltas", () => {
  const buffalo = roster(
    { id: "wr-one", position: "WR", snapShare: 0.8 },
    { id: "wr-two", position: "WR", snapShare: 0.5 },
    { id: "te-one", position: "TE", snapShare: 0.7 },
    { id: "rb-one", position: "RB", snapShare: 0.6 },
  );

  it("PINS THE PLAN'S FIRST CASE: a receiver whose team lost its primary target projects a larger share", () => {
    const deltas = offseasonDeltas({
      moves: [
        { playerId: "departed", position: "WR", from: "BUF", to: "HOU", targetShare: 0.26, carryShare: 0 },
      ],
      rosters: new Map([["BUF", buffalo]]),
      absorptionRate: ABSORPTION,
    });
    expect(deltas.get("wr-one")!.targetShare).toBeGreaterThan(0);
    // The other receiver gains too, but less: he is behind on the depth chart snap share reads.
    expect(deltas.get("wr-one")!.targetShare).toBeGreaterThan(deltas.get("wr-two")!.targetShare);
    // The back gains almost nothing from a departed receiver's targets, which is the position
    // affinity `redistribution.ts` owns and this module must not be re-deciding.
    expect(deltas.get("rb-one")!.targetShare).toBeLessThan(deltas.get("wr-one")!.targetShare);
  });

  it("PINS THE PLAN'S SECOND CASE: a back who signs somewhere with an entrenched starter takes work off him", () => {
    const deltas = offseasonDeltas({
      moves: [
        { playerId: "signed", position: "RB", from: "DEN", to: "BUF", targetShare: 0.05, carryShare: 0.5 },
      ],
      rosters: new Map([["BUF", buffalo]]),
      absorptionRate: ABSORPTION,
    });
    // The incumbent LOSES carry share, because an arrival takes work from the same people a
    // departure would have given it to.
    expect(deltas.get("rb-one")!.carryShare).toBeLessThan(0);
  });

  it("nets a club that lost one receiver and signed another, rather than moving it twice", () => {
    const both = offseasonDeltas({
      moves: [
        { playerId: "out", position: "WR", from: "BUF", to: "HOU", targetShare: 0.24, carryShare: 0 },
        { playerId: "in", position: "WR", from: "HOU", to: "BUF", targetShare: 0.24, carryShare: 0 },
      ],
      rosters: new Map([["BUF", buffalo]]),
      absorptionRate: ABSORPTION,
    });
    expect(both.get("wr-one")!.targetShare).toBeCloseTo(0, 10);
  });

  it("leaves a club nobody moved to or from completely alone", () => {
    const deltas = offseasonDeltas({
      moves: [{ playerId: "stayed", position: "WR", from: "BUF", to: "BUF", targetShare: 0.24, carryShare: 0 }],
      rosters: new Map([["BUF", buffalo]]),
      absorptionRate: ABSORPTION,
    });
    expect(deltas.size).toBe(0);
  });

  it("ignores a move that carried no work with it", () => {
    // A fifth receiver who took one percent of the targets is a transaction and is not a
    // redistribution. Putting him through the weights would move nothing and make the log unreadable.
    const deltas = offseasonDeltas({
      moves: [{ playerId: "fringe", position: "WR", from: "BUF", to: "HOU", targetShare: 0, carryShare: 0 }],
      rosters: new Map([["BUF", buffalo]]),
      absorptionRate: ABSORPTION,
    });
    expect(deltas.size).toBe(0);
  });

  it("does nothing for a club whose roster it was not given", () => {
    const deltas = offseasonDeltas({
      moves: [{ playerId: "out", position: "WR", from: "BUF", to: "HOU", targetShare: 0.24, carryShare: 0 }],
      rosters: new Map(),
      absorptionRate: ABSORPTION,
    });
    expect(deltas.size).toBe(0);
  });
});

describe("changedSituationSegment", () => {
  const moves: readonly OffseasonMove[] = [
    { playerId: "mover", position: "WR", from: "BUF", to: "HOU", targetShare: 0.24, carryShare: 0 },
    { playerId: "stayer", position: "WR", from: "KC", to: "KC", targetShare: 0.2, carryShare: 0 },
  ];
  const rosters = new Map([
    ["BUF", roster({ id: "buf-wr", position: "WR", snapShare: 0.8 })],
    ["HOU", roster({ id: "hou-wr", position: "WR", snapShare: 0.8 })],
    ["KC", roster({ id: "kc-wr", position: "WR", snapShare: 0.8 })],
  ]);

  it("holds the man who moved AND the teammates on both ends, which is where the feature has to be right", () => {
    const segment = changedSituationSegment(moves, rosters);
    expect(segment.has("mover")).toBe(true);
    expect(segment.has("buf-wr")).toBe(true);
    expect(segment.has("hou-wr")).toBe(true);
  });

  it("leaves out a club nothing happened to, so the segment is the players the feature can move", () => {
    expect(changedSituationSegment(moves, rosters).has("kc-wr")).toBe(false);
  });
});
