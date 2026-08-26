import { describe, expect, it } from "vitest";
import { MOCK_BOT_TEAM_NAME_POOL } from "./config";
import { pickBotTeamNames } from "./team-names";

describe("pickBotTeamNames", () => {
  it("is deterministic under one seed", () => {
    expect(pickBotTeamNames(5, 8)).toEqual(pickBotTeamNames(5, 8));
  });

  it("returns distinct names, never a repeat within one draw", () => {
    const names = pickBotTeamNames(11, 12);
    expect(new Set(names).size).toBe(names.length);
  });

  it("varies across seeds", () => {
    const drawn = [1, 2, 3, 4].map((seed) => JSON.stringify(pickBotTeamNames(seed, 10)));
    expect(new Set(drawn).size).toBeGreaterThan(1);
  });

  it("returns exactly the requested count, taken off the front of a shuffled pool", () => {
    expect(pickBotTeamNames(9, 5)).toHaveLength(5);
    for (const name of pickBotTeamNames(9, 5)) {
      expect(MOCK_BOT_TEAM_NAME_POOL).toContain(name);
    }
  });

  it("handles a count at the pool's own floor: the whole pool, shuffled, still fully distinct", () => {
    const names = pickBotTeamNames(13, MOCK_BOT_TEAM_NAME_POOL.length);
    expect(names).toHaveLength(MOCK_BOT_TEAM_NAME_POOL.length);
    expect(new Set(names).size).toBe(MOCK_BOT_TEAM_NAME_POOL.length);
    expect([...names].sort()).toEqual([...MOCK_BOT_TEAM_NAME_POOL].sort());
  });

  it("returns nothing for a zero count", () => {
    expect(pickBotTeamNames(1, 0)).toEqual([]);
  });
});
