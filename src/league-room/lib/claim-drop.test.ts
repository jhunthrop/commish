import { describe, expect, it } from "vitest";
import type { LineupSlotView } from "../contract";
import { rankDropCandidates } from "./claim-drop";

const bench = (
  playerId: string,
  playerName: string,
  adp: number | null,
  slotIndex: number,
): LineupSlotView => ({
  slot: "BENCH",
  slotIndex,
  playerId,
  playerName,
  position: "WR",
  nflTeam: "GB",
  headshotUrl: null,
  adp,
  injuryDesignation: null,
});

const BENCH: readonly LineupSlotView[] = [
  bench("p1", "Romeo Doubs", 90, 0),
  bench("p2", "Quentin Johnston", 120, 1),
  bench("p3", "Jalen McMillan", 110, 2),
];

describe("rankDropCandidates", () => {
  it("puts the lowest-projected bench player first", () => {
    const ranked = rankDropCandidates(
      BENCH,
      new Map([
        ["p1", 9.8],
        ["p2", 6.4],
        ["p3", 7.1],
      ]),
    );
    expect(ranked.map((candidate) => candidate.playerId)).toEqual(["p2", "p3", "p1"]);
    expect(ranked[0]?.projection).toBe(6.4);
  });

  it("breaks projection ties by the later ADP", () => {
    const ranked = rankDropCandidates(
      BENCH,
      new Map([
        ["p1", 7.0],
        ["p2", 7.0],
        ["p3", 7.0],
      ]),
    );
    expect(ranked[0]?.playerId).toBe("p2");
  });

  it("treats an undrafted player as the first to go when projections are empty", () => {
    const undrafted = [...BENCH, bench("p4", "Practice Squad Guy", null, 3)];
    const ranked = rankDropCandidates(undrafted, new Map());
    expect(ranked[0]?.playerId).toBe("p4");
  });

  it("orders two undrafted players ahead of a drafted one on a projection tie, never NaN-shuffled", () => {
    const mixed = [bench("p1", "Drafted Guy", 90, 0), bench("p2", "Undrafted A", null, 1), bench("p3", "Undrafted B", null, 2)];
    const ranked = rankDropCandidates(mixed, new Map());
    // Both undrafted players lead (dropped first); the drafted player is last. A NaN in the
    // comparator would make this order engine-defined rather than stable.
    expect(ranked.map((candidate) => candidate.playerId).slice(0, 2).sort()).toEqual(["p2", "p3"]);
    expect(ranked[2]?.playerId).toBe("p1");
  });

  it("skips empty bench slots", () => {
    const withEmpty: readonly LineupSlotView[] = [
      ...BENCH,
      { ...bench("x", "x", null, 3), playerId: null, playerName: null, position: null },
    ];
    expect(rankDropCandidates(withEmpty, new Map())).toHaveLength(3);
  });
});
