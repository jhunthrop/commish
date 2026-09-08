import { describe, expect, it } from "vitest";
import type { MatchFields } from "./match";
import { buildSearchIndex, searchIndex } from "./index";
import type { SearchEntry } from "./entries";
import type { SearchResult } from "./contract";

function player(id: string, name: string, position: "QB" | "RB" | "WR" | "TE" | "K" | "DEF", team: string, teamWords: readonly string[], order: number, boardRank: number | null = order + 1): SearchEntry {
  const fields: MatchFields = { name: name.toLowerCase().replace(/['.]/g, "").replace(/-/g, " "), team: teamWords, position: position.toLowerCase() };
  const result: SearchResult = {
    kind: "player",
    player: { id, name, position, nflTeam: team, headshotUrl: null, adp: null },
    positionRank: 1,
    boardRank,
    byeWeek: null,
  };
  return { fields, result, order };
}

function team(code: string, name: string, order: number): SearchEntry {
  return { fields: { name: `${name.toLowerCase()} ${code.toLowerCase()}`, team: [], position: null }, result: { kind: "team", code, name, byeWeek: null }, order };
}

const CIN = ["cin", "cincinnati", "bengals"];
const DET = ["det", "detroit", "lions"];
const JAX = ["jax", "jacksonville", "jaguars"];

const ENTRIES: readonly SearchEntry[] = [
  player("chase", "Ja'Marr Chase", "WR", "CIN", CIN, 0),
  player("gibbs", "Jahmyr Gibbs", "RB", "DET", DET, 1),
  player("stbrown", "Amon-Ra St. Brown", "WR", "DET", DET, 2),
  player("jsn", "Jaxon Smith-Njigba", "WR", "SEA", ["sea", "seattle", "seahawks"], 3),
  player("jacobs", "Josh Jacobs", "RB", "GB", ["gb", "green bay", "packers"], 4),
  player("jarvis", "Jarvis Bench", "WR", "JAX", JAX, 5),
  team("DET", "Detroit Lions", 6),
  team("JAX", "Jacksonville Jaguars", 7),
  player("DST-DET", "Detroit Lions", "DEF", "DET", DET, 8, null),
  player("bates", "Jake Bates", "K", "DET", DET, 9, null),
];

const index = buildSearchIndex(ENTRIES);
const idsFor = (query: string, limit = 8) => searchIndex(index, query, limit).map((result) => (result.kind === "player" ? result.player.id : `team:${result.code}`));

describe("searchIndex", () => {
  it("answers nothing for a blank query", () => {
    expect(idsFor("")).toEqual([]);
    expect(idsFor("   ")).toEqual([]);
  });

  it("ranks a prefix tie by board rank, the team entity after the projected board, K and DEF last", () => {
    expect(idsFor("ja")).toEqual(["chase", "gibbs", "jsn", "jacobs", "jarvis", "team:JAX", "bates"]);
  });

  it("puts the team page first on its nickname, then the defense row and the players by board rank", () => {
    expect(idsFor("lions")).toEqual(["team:DET", "DST-DET", "gibbs", "stbrown", "bates"]);
  });

  it("finds a name typed without its punctuation, and with it", () => {
    expect(idsFor("st brown")).toEqual(["stbrown"]);
    expect(idsFor("St. Brown")).toEqual(["stbrown"]);
    expect(idsFor("smith njigba")).toEqual(["jsn"]);
    expect(idsFor("Smith-Njigba")).toEqual(["jsn"]);
  });

  it("finds a city, a code and a position", () => {
    expect(idsFor("Detroit")).toEqual(["team:DET", "DST-DET", "gibbs", "stbrown", "bates"]);
    // "det" is an EXACT team word on every Lion and only a PREFIX of the defense row's own name, and
    // tier outranks field: the projected Lions come first and the market-order rows follow in order.
    expect(idsFor("DET")).toEqual(["team:DET", "gibbs", "stbrown", "DST-DET", "bates"]);
    expect(idsFor("wr")).toEqual(["chase", "stbrown", "jsn", "jarvis"]);
    expect(idsFor("det wr")).toEqual(["stbrown"]);
  });

  it("forgives one typo and ranks it under every stronger match", () => {
    expect(idsFor("gibs")).toEqual(["gibbs"]);
    expect(idsFor("jacobz")).toEqual(["jacobs"]);
  });

  it("caps the list at the limit", () => {
    expect(idsFor("ja", 2)).toEqual(["chase", "gibbs"]);
  });

  it("answers an empty list, never an invented row, for a query nothing matches", () => {
    expect(idsFor("zzq")).toEqual([]);
    expect(idsFor("JC")).toEqual([]);
  });
});
