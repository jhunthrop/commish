import { describe, expect, it } from "vitest";
import { BOT_ARCHETYPES, assignArchetypes } from "./archetypes";

/** Eleven bot seats — the widest room (12 teams) with one human, the deal's hardest case. */
const BOTS = Array.from({ length: 11 }, (_, i) => `bot_${String(i + 1).padStart(2, "0")}`);

describe("BOT_ARCHETYPES", () => {
  it("fields seven distinctly named brains", () => {
    expect(BOT_ARCHETYPES).toHaveLength(7);
    expect(new Set(BOT_ARCHETYPES.map((a) => a.name)).size).toBe(BOT_ARCHETYPES.length);
  });

  it("keeps every weight positive, so no archetype can zero a position out of a draft", () => {
    for (const archetype of BOT_ARCHETYPES) {
      expect(archetype.needWeight).toBeGreaterThan(0);
      for (const bias of Object.values(archetype.posBias)) {
        expect(bias).toBeGreaterThan(0);
      }
    }
  });

  it("marks exactly one archetype as the run follower", () => {
    expect(BOT_ARCHETYPES.filter((a) => a.followsRuns === true).map((a) => a.name)).toEqual(["run_follower"]);
  });
});

describe("assignArchetypes", () => {
  it("assigns every requested bot exactly one archetype", () => {
    const assigned = assignArchetypes(5, BOTS);
    expect(Object.keys(assigned).sort()).toEqual([...BOTS].sort());
  });

  it("is deterministic under one seed", () => {
    expect(assignArchetypes(7, BOTS)).toEqual(assignArchetypes(7, BOTS));
  });

  it("varies across seeds", () => {
    const dealt = [7, 8, 9, 10].map((seed) => JSON.stringify(assignArchetypes(seed, BOTS)));
    expect(new Set(dealt).size).toBeGreaterThan(1);
  });

  it("spreads the deck: a full room fields every archetype, never eleven copies of one brain", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const names = Object.values(assignArchetypes(seed, BOTS)).map((a) => a.name);
      expect(new Set(names).size).toBe(BOT_ARCHETYPES.length);
    }
  });

  it("keeps a room of seven or fewer bots fully distinct", () => {
    const seven = BOTS.slice(0, 7);
    const names = Object.values(assignArchetypes(3, seven)).map((a) => a.name);
    expect(new Set(names).size).toBe(seven.length);
  });
});
