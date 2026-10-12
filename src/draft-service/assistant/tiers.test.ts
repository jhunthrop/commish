import { describe, expect, it } from "vitest";
import { availablePool } from "@/draft-engine";
import { tiersOf } from "@research-ts/projections/decide/tiers";
import { shipsProjectedRows } from "@research-ts/projections/preseason/kdef-decision";
import { tierStandings } from "./tiers";
import { FIXTURE_POOL, fixtureAdvance, fixtureStart, fixtureValued } from "./test-fixture";

describe("tierStandings", () => {
  it("stands every undrafted projected player in his position's full-board tier, counting who is left, and skips market-order positions", () => {
    const state = fixtureAdvance(fixtureStart(), 12);
    const valued = fixtureValued();
    const standings = tierStandings(state, valued);
    const drafted = new Set(state.picks.map((pick) => pick.playerId));
    for (const entry of availablePool(state)) {
      const standing = standings[entry.playerId];
      if (!shipsProjectedRows(entry.position)) {
        expect(standing).toBeUndefined();
        continue;
      }
      const position = FIXTURE_POOL.filter((row) => row.position === entry.position).sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId));
      const tiers = tiersOf(position.map((row) => row.projectedPoints));
      const index = position.findIndex((row) => row.playerId === entry.playerId);
      const tier = tiers[index]!;
      const members = position.filter((_, i) => tiers[i] === tier);
      expect(standing).toEqual({ tier: tier + 1, left: members.filter((row) => !drafted.has(row.playerId)).length, size: members.length });
    }
    expect(Object.keys(standings).some((id) => drafted.has(id))).toBe(false);
  });

  it("counts a tier down as the room takes from it", () => {
    const before = tierStandings(fixtureStart(), fixtureValued());
    const after = tierStandings(fixtureAdvance(fixtureStart(), 12), fixtureValued());
    const shrunk = Object.entries(after).filter(([id, standing]) => before[id]!.left > standing.left);
    expect(shrunk.length).toBeGreaterThan(0);
    for (const [id, standing] of Object.entries(after)) expect(standing.size).toBe(before[id]!.size);
  });
});
