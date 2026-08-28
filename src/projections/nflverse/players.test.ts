import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { readFixture } from "./fixtures";
import {
  buildPlayerUniverse,
  mapNflPlayers,
  nflPlayerRows,
  projectedPosition,
  type NflPlayer,
} from "./players";

const UNIVERSE = mapNflPlayers(parseCsv(readFixture("players_slice.csv")));

function named(name: string): readonly NflPlayer[] {
  return UNIVERSE.filter((player) => player.name === name);
}

describe("mapNflPlayers", () => {
  it("carries a player who has since retired", () => {
    // The exact case Phase 1 measured and could not fix: `players` is a 2026 roster snapshot, so a
    // 2023 season's retirees were genuinely absent from it and their seasons were invisible.
    const murray = named("Latavius Murray");
    expect(murray).toHaveLength(1);
    expect(murray[0]).toMatchObject({
      id: "00-0030513",
      pfrId: "MurrLa00",
      position: "RB",
      rookieSeason: 2013,
      lastSeason: 2023,
    });
  });

  it("keeps two men who share a name apart, because it never reads the name", () => {
    const allens = named("Josh Allen");
    expect(allens.map((player) => player.id).sort()).toEqual(["00-0030833", "00-0034857"]);
    expect(new Set(allens.map((player) => player.pfrId)).size).toBe(2);
  });

  it("refuses a universe row with no gsis id rather than inventing one", () => {
    expect(() => mapNflPlayers([{ gsis_id: "", display_name: "Nobody", position: "WR" }])).toThrow(/gsis_id/);
  });
});

describe("projectedPosition", () => {
  it("narrows the positions this product scores", () => {
    expect(projectedPosition("QB")).toBe("QB");
    expect(projectedPosition("TE")).toBe("TE");
  });

  it("reads a fullback as a running back, which is how every scoring feed treats one", () => {
    expect(projectedPosition("FB")).toBe("RB");
  });

  it("returns null for a position the engine does not project", () => {
    expect(projectedPosition("C")).toBeNull();
    expect(projectedPosition("LB")).toBeNull();
  });
});

describe("buildPlayerUniverse", () => {
  const universe = buildPlayerUniverse(UNIVERSE);

  it("resolves a snap-counts row by its pro-football-reference id", () => {
    expect(universe.byPfrId("AlleJo02")?.id).toBe("00-0034857");
  });

  it("resolves a weekly-stats row by its gsis id", () => {
    expect(universe.byGsisId("00-0034857")?.name).toBe("Josh Allen");
  });

  it("answers null for an id it does not hold, never a guess", () => {
    expect(universe.byPfrId("AndeAl01")).toBeNull();
    expect(universe.byGsisId("00-9999999")).toBeNull();
  });

  it("refuses to build when two people claim one pro-football-reference id", () => {
    const twin = { ...UNIVERSE[0]!, id: "00-0000001" };
    expect(() => buildPlayerUniverse([...UNIVERSE, twin])).toThrow(/pfr/i);
  });
});

describe("resolveAll", () => {
  const universe = buildPlayerUniverse(UNIVERSE);

  it("reports the rate over distinct people and names everyone it could not place", () => {
    const resolution = universe.resolveAll([
      { kind: "pfr", id: "AlleJo02", name: "Josh Allen" },
      { kind: "pfr", id: "AlleJo02", name: "Josh Allen" },
      { kind: "pfr", id: "AndeAl01", name: "Alec Anderson" },
    ]);
    // Two distinct people, one of them absent — a star appearing eighteen times must not weigh
    // eighteen times as much as a backup in the number the plan's stop condition is checked against.
    expect(resolution.resolutionRate).toBeCloseTo(0.5, 10);
    expect(resolution.unresolved).toEqual([{ kind: "pfr", id: "AndeAl01", name: "Alec Anderson", occurrences: 1 }]);
    expect(resolution.resolved.get("AlleJo02")).toBe("00-0034857");
  });

  it("reports null rather than a flattering 1.0 for an empty universe of candidates", () => {
    expect(universe.resolveAll([]).resolutionRate).toBeNull();
  });
});

describe("nflPlayerRows", () => {
  it("writes every column the store's foreign key and the model's role prior need", () => {
    const row = nflPlayerRows(named("Latavius Murray"))[0]!;
    expect(row).toEqual({
      id: "00-0030513",
      pfrId: "MurrLa00",
      name: "Latavius Murray",
      position: "RB",
      latestTeam: "BUF",
      rookieSeason: 2013,
      lastSeason: 2023,
    });
  });
});
