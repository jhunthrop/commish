import { describe, expect, it } from "vitest";
import { NFL_TEAM_ABBREVIATIONS } from "@research-ts/projections/capture-feeds";
import { clubIndex } from "./club-index";
import { resolveTeamRoute } from "./route";

describe("the club index", () => {
  it("names all 32 clubs, once each", () => {
    const rows = clubIndex();
    expect(rows).toHaveLength(32);
    expect(new Set(rows.map((row) => row.code)).size).toBe(32);
    expect([...rows.map((row) => row.code)].sort()).toEqual([...NFL_TEAM_ABBREVIATIONS].sort());
  });

  /** The bug this index would otherwise have shipped with: `NFL_TEAM_NAMES` keys both spellings
   *  of three franchises plus two historical cities, so walking THAT map lists the Rams, the
   *  Commanders and the Raiders twice and puts the Chargers in San Diego. */
  it("lists no franchise twice and no city the league has left", () => {
    const rows = clubIndex();
    const franchises = rows.map((row) => `${row.city} ${row.nickname}`);
    expect(new Set(franchises).size).toBe(franchises.length);
    expect(franchises).not.toContain("San Diego Chargers");
    expect(franchises).not.toContain("St. Louis Rams");
    expect(franchises).not.toContain("Oakland Raiders");
  });

  it("links every row at a URL that serves without a redirect", () => {
    for (const row of clubIndex()) {
      expect(row.href).toBe(`/app/teams/${row.code}`);
      expect(resolveTeamRoute(row.code)).toEqual({ kind: "canonical", code: row.code });
    }
  });

  it("reads in city order, so a city's two clubs sit together", () => {
    const cities = clubIndex().map((row) => row.city);
    expect(cities).toEqual([...cities].sort((left, right) => left.localeCompare(right)));
    const newYork = clubIndex().filter((row) => row.city === "New York");
    expect(newYork.map((row) => row.nickname)).toEqual(["Giants", "Jets"]);
  });
});
