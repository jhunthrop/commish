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

  it("skips excluded names without disturbing the deck's order (T2 review MEDIUM)", () => {
    // The exclusion is what makes naming safe under ANY caller batching: a name already on a
    // team row in the league — a host who picked a pool name for themselves, or an earlier bot
    // batch — is simply not in this draw, and the rest of the deck arrives in its seeded order.
    const full = pickBotTeamNames(7, 5);
    const excluded = new Set([full[0]!, full[2]!]);
    const drawn = pickBotTeamNames(7, 3, excluded);
    expect(drawn).toEqual([full[1]!, full[3]!, full[4]!]);
    expect(drawn.some((name) => excluded.has(name))).toBe(false);
  });

  it("throws rather than repeat a name when exclusions exhaust the pool", () => {
    const everything = new Set(MOCK_BOT_TEAM_NAME_POOL);
    expect(() => pickBotTeamNames(3, 1, everything)).toThrow(/pool/);
  });

  it("returns nothing for a zero count", () => {
    expect(pickBotTeamNames(1, 0)).toEqual([]);
  });
});
