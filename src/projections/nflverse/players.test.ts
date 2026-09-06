import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { readFixture } from "./fixtures";
import {
  buildPlayerUniverse,
  isProjectedCandidate,
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
      espnId: "15920",
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

  it("recognizes a kicker, who is projected from the 2026-09-05 round on", () => {
    expect(projectedPosition("K")).toBe("K");
    // The stats provider's own spelling, which belongs to a different feed and never reaches here.
    expect(projectedPosition("PK")).toBeNull();
  });

  /**
   * A team defence is not a person, so no row in any nflverse file is one and no file position could
   * ever narrow to it. The 32 defences are built from synthetic universe rows by their own candidate
   * builder, which is why the spec calls for a separate builder rather than a wider gate.
   */
  it("still narrows a team defence to nothing, because no source row is one", () => {
    expect(projectedPosition("DEF")).toBeNull();
    expect(projectedPosition("DST")).toBeNull();
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

/**
 * THE CROSSWALK CLASS, PINNED (fit-round Task 1). Each case below is a real shape measured in the
 * published feeds, not a hypothetical: the fullback (4,704 dropped skill player-weeks across
 * 2003-2024), the blank `position` column (Trent Richardson's 2012 rookie season), and the
 * later-career spelling (a receiver a file lists as DL). Before this gate existed, all three were
 * dropped BEFORE the universe was consulted, so none of them even appeared in the unresolved report
 * that exists to make a silent drop visible.
 */
describe("isProjectedCandidate", () => {
  function player(overrides: Partial<NflPlayer> & Pick<NflPlayer, "id" | "position">): NflPlayer {
    return {
      pfrId: null,
      espnId: null,
      name: "Test Player",
      latestTeam: null,
      rookieSeason: null,
      lastSeason: null,
      ...overrides,
    };
  }

  const universe = buildPlayerUniverse([
    player({ id: "00-0000001", position: "FB", name: "A Fullback", pfrId: "FullBa00" }),
    player({ id: "00-0000002", position: "RB", name: "A Back", pfrId: "BackAa00" }),
    player({ id: "00-0000003", position: "WR", name: "A Receiver", pfrId: "RecvAa00" }),
    player({ id: "00-0000004", position: "C", name: "A Centre", pfrId: "CentAa00" }),
  ]);

  const gsis = (id: string) => ({ kind: "gsis" as const, id, name: "" });
  const pfr = (id: string) => ({ kind: "pfr" as const, id, name: "" });

  it("admits a fullback, because projectedPosition calls him a running back and the file does not", () => {
    expect(isProjectedCandidate(universe, gsis("00-0000001"), "FB")).toBe(true);
  });

  it("admits a row whose position column is blank, because the universe knows what he plays", () => {
    // Richardson's 2012: fifteen weeks published with an empty `position`, fifteen weeks dropped.
    expect(isProjectedCandidate(universe, gsis("00-0000002"), "")).toBe(true);
    expect(isProjectedCandidate(universe, gsis("00-0000002"), undefined)).toBe(true);
  });

  it("admits a receiver a file spells with a later-career position, because the universe governs", () => {
    expect(isProjectedCandidate(universe, gsis("00-0000003"), "DL")).toBe(true);
  });

  it("refuses a centre however the file spells him, for the same reason", () => {
    expect(isProjectedCandidate(universe, gsis("00-0000004"), "C")).toBe(false);
    // The file claiming a projected position does NOT rescue him: the universe is what the backtest
    // scores through, and a row stored for a man it cannot score is a row nothing reads.
    expect(isProjectedCandidate(universe, gsis("00-0000004"), "WR")).toBe(false);
  });

  it("reads the same answer through the pfr id, which is the id the snap-count file carries", () => {
    expect(isProjectedCandidate(universe, pfr("FullBa00"), "FB")).toBe(true);
    expect(isProjectedCandidate(universe, pfr("CentAa00"), "WR")).toBe(false);
  });

  it("falls back to the file's own spelling ONLY for a man the universe cannot place", () => {
    // He stays a candidate so he lands in the unresolved report, named and counted, rather than
    // disappearing — and the fallback narrows through `projectedPosition`, so an unplaceable
    // fullback counts as a missing skill player rather than as no player at all.
    expect(isProjectedCandidate(universe, gsis("00-0009999"), "FB")).toBe(true);
    expect(isProjectedCandidate(universe, gsis("00-0009999"), "WR")).toBe(true);
    expect(isProjectedCandidate(universe, gsis("00-0009999"), "C")).toBe(false);
    expect(isProjectedCandidate(universe, gsis("00-0009999"), "")).toBe(false);
  });
});

describe("nflPlayerRows", () => {
  it("writes every column the store's foreign key and the model's role prior need", () => {
    const row = nflPlayerRows(named("Latavius Murray"))[0]!;
    expect(row).toEqual({
      id: "00-0030513",
      pfrId: "MurrLa00",
      espnId: "15920",
      name: "Latavius Murray",
      position: "RB",
      latestTeam: "BUF",
      rookieSeason: 2013,
      lastSeason: 2023,
    });
  });
});
