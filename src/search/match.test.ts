import { describe, expect, it } from "vitest";
import { compareMatches, matchAgainst, withinOneEdit, type MatchFields } from "./match";

const CHASE: MatchFields = { name: "jamarr chase", team: ["cin", "cincinnati", "bengals"], position: "wr" };
const LIONS_TEAM: MatchFields = { name: "detroit lions det", team: [], position: null };

describe("withinOneEdit", () => {
  it("accepts one substitution, insertion, deletion or transposition", () => {
    expect(withinOneEdit("gibbs", "gibbs")).toBe(true);
    expect(withinOneEdit("gibs", "gibbs")).toBe(true);
    expect(withinOneEdit("gibbbs", "gibbs")).toBe(true);
    expect(withinOneEdit("gobbs", "gibbs")).toBe(true);
    expect(withinOneEdit("gbibs", "gibbs")).toBe(true);
  });

  it("refuses two edits and a length gap of two", () => {
    expect(withinOneEdit("gobbz", "gibbs")).toBe(false);
    expect(withinOneEdit("gib", "gibbs")).toBe(false);
    expect(withinOneEdit("", "ab")).toBe(false);
  });
});

describe("matchAgainst", () => {
  it("is exact when every query word equals a word of the entry", () => {
    expect(matchAgainst(["chase"], CHASE)).toEqual({ tier: "exact", priority: 0 });
    expect(matchAgainst(["jamarr", "chase"], CHASE)).toEqual({ tier: "exact", priority: 0 });
  });

  it("is a prefix when every query word starts a word of the entry", () => {
    expect(matchAgainst(["ja"], CHASE)).toEqual({ tier: "prefix", priority: 0 });
    expect(matchAgainst(["ja", "ch"], CHASE)).toEqual({ tier: "prefix", priority: 0 });
  });

  it("matches a player's team code, city and nickname at the team priority", () => {
    expect(matchAgainst(["cin"], CHASE)).toEqual({ tier: "exact", priority: 1 });
    expect(matchAgainst(["beng"], CHASE)).toEqual({ tier: "prefix", priority: 1 });
    expect(matchAgainst(["cincinnati"], CHASE)).toEqual({ tier: "exact", priority: 1 });
  });

  it("matches a position only as a whole word, at the lowest priority", () => {
    expect(matchAgainst(["wr"], CHASE)).toEqual({ tier: "exact", priority: 2 });
    expect(matchAgainst(["w"], CHASE)).toBeNull();
  });

  it("lets one query cross fields: a team word and a position word together", () => {
    expect(matchAgainst(["cin", "wr"], CHASE)).toEqual({ tier: "exact", priority: 1 });
    expect(matchAgainst(["ja", "cin"], CHASE)).toEqual({ tier: "prefix", priority: 0 });
  });

  it("falls back to a substring of the whole name", () => {
    expect(matchAgainst(["arr", "ch"], CHASE)).toEqual({ tier: "substring", priority: 0 });
    expect(matchAgainst(["marr"], CHASE)).toEqual({ tier: "substring", priority: 0 });
  });

  it("forgives one typo from four characters on, and never on a short word", () => {
    expect(matchAgainst(["chsae"], CHASE)).toEqual({ tier: "fuzzy", priority: 0 });
    expect(matchAgainst(["jamar"], CHASE)).toEqual({ tier: "prefix", priority: 0 });
    expect(matchAgainst(["jamer"], CHASE)).toEqual({ tier: "fuzzy", priority: 0 });
    expect(matchAgainst(["cha"], CHASE)).toEqual({ tier: "prefix", priority: 0 });
    expect(matchAgainst(["cxa"], CHASE)).toBeNull();
  });

  it("forgives at most one typo across a whole query", () => {
    expect(matchAgainst(["jamer", "chsae"], CHASE)).toBeNull();
  });

  it("names nothing it does not hold: no invented initialisms", () => {
    expect(matchAgainst(["jc"], CHASE)).toBeNull();
    expect(matchAgainst(["zz"], CHASE)).toBeNull();
    expect(matchAgainst([], CHASE)).toBeNull();
  });

  it("matches a team entity on its own name at the top priority", () => {
    expect(matchAgainst(["lions"], LIONS_TEAM)).toEqual({ tier: "exact", priority: 0 });
    expect(matchAgainst(["det"], LIONS_TEAM)).toEqual({ tier: "exact", priority: 0 });
    expect(matchAgainst(["detr"], LIONS_TEAM)).toEqual({ tier: "prefix", priority: 0 });
  });
});

describe("compareMatches", () => {
  it("orders by tier, then priority, then the caller's own order", () => {
    const a = { tier: "exact" as const, priority: 1 };
    const b = { tier: "prefix" as const, priority: 0 };
    const c = { tier: "exact" as const, priority: 0 };
    expect(compareMatches(a, b)).toBeLessThan(0);
    expect(compareMatches(c, a)).toBeLessThan(0);
    expect(compareMatches(a, a)).toBe(0);
  });
});
