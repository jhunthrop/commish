import { describe, expect, it } from "vitest";
import { depthChartFor, type DepthRow } from "./depth-chart";

const asOf = new Date("2026-09-01T12:20:07.000Z");
const rows: readonly DepthRow[] = [
  { playerId: "a", team: "NYG", position: "WR", slot: 1, season: 2026, asOf },
  { playerId: "b", team: "NYG", position: "WR", slot: 2, season: 2026, asOf },
  { playerId: "c", team: "NYG", position: "RB", slot: 1, season: 2026, asOf },
  { playerId: "d", team: "DAL", position: "WR", slot: 1, season: 2026, asOf },
];
const names = new Map([
  ["a", "Malik Nabers"],
  ["b", "Wan'Dale Robinson"],
  ["c", "Tyrone Tracy"],
  ["d", "CeeDee Lamb"],
]);

describe("depthChartFor", () => {
  it("states his own dated slot and only his own team's own position group", () => {
    expect(depthChartFor("a", "NYG", "WR", rows, names)).toEqual({
      season: 2026,
      asOf: "2026-09-01",
      slot: 1,
      aroundHim: [{ name: "Wan'Dale Robinson", slot: 2 }],
    });
  });

  it("returns nothing at all when the release never named him", () => {
    expect(depthChartFor("z", "NYG", "WR", rows, names)).toBeNull();
  });

  it("caps a deep position group rather than listing the whole room", () => {
    const deep = Array.from({ length: 9 }, (_, i): DepthRow => ({ playerId: `p${i}`, team: "NYG", position: "WR", slot: i + 1, season: 2026, asOf }));
    expect(depthChartFor("p0", "NYG", "WR", deep, new Map())!.aroundHim).toHaveLength(4);
  });

  it("falls back to the bare id rather than dropping a neighbour the universe has no name row for", () => {
    expect(depthChartFor("a", "NYG", "WR", rows, new Map())!.aroundHim).toEqual([{ name: "b", slot: 2 }]);
  });
});
