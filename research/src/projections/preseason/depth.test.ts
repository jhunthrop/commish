import { describe, expect, it } from "vitest";
import type { Position } from "@research/domain/player";
import type { CsvRow } from "../nflverse/csv";
import type { PredictedOpportunity } from "../model/opportunity";
import {
  applyDepthChart,
  depthMultiplier,
  depthRankFor,
  DEPTH_METRIC,
  DEPTH_RANKS,
  DEPTH_SOURCE,
  mapDepthChart,
  type DepthChart,
  type DepthPriors,
} from "./depth";

const AS_OF = new Date("2023-09-08T00:19:59.999Z");

function row(over: Partial<CsvRow>): CsvRow {
  return {
    season: "2023",
    week: "1",
    game_type: "REG",
    formation: "Offense",
    depth_team: "1",
    depth_position: "QB",
    gsis_id: "00-0000001",
    ...over,
  };
}

const PRIORS: DepthPriors = {
  bySnapShare: {
    QB: { first: 1.5, second: 0.6, third: 0.7, offChart: 0.5 },
    RB: { first: 1.2, second: 1.2, third: 0.8, offChart: 0.5 },
    WR: { first: 1.3, second: 1.05, third: 0.8, offChart: 0.4 },
    TE: { first: 1.2, second: 1.06, third: 0.9, offChart: 0.5 },
    K: { first: 1, second: 1, third: 1, offChart: 1 },
    DEF: { first: 1, second: 1, third: 1, offChart: 1 },
  },
  bound: 1,
};

function predicted(playerId: string, snapShare: number): PredictedOpportunity {
  return {
    playerId,
    snapShare,
    targetShare: 0.2,
    carryShare: 0.1,
    passAttemptShare: 0.5,
    teamTargets: 35,
    teamCarries: 26,
    teamPassAttempts: 34,
  };
}

describe("depthRankFor", () => {
  it("names the three published ranks and the absence, which is a different fact", () => {
    expect(depthRankFor(1)).toBe("first");
    expect(depthRankFor(2)).toBe("second");
    expect(depthRankFor(3)).toBe("third");
    // Charts run to three; anything past it is third string by the same reasoning.
    expect(depthRankFor(4)).toBe("third");
    expect(depthRankFor(null)).toBe("offChart");
  });
});

describe("mapDepthChart", () => {
  const projected = new Set(["00-0000001", "00-0000002"]);

  it("keeps only week one, the regular season and the offence", () => {
    const mapped = mapDepthChart(
      [
        row({}),
        row({ week: "2", gsis_id: "00-0000002" }),
        row({ game_type: "POST", gsis_id: "00-0000002" }),
        row({ formation: "Defense", gsis_id: "00-0000002" }),
      ],
      projected,
      2023,
      AS_OF,
    );
    expect(mapped.observations).toEqual([
      { season: 2023, week: 1, playerId: "00-0000001", source: DEPTH_SOURCE, metric: DEPTH_METRIC, value: 1, asOf: AS_OF },
    ]);
  });

  it("KEEPS A MAN'S BEST RANK where his club lists him in several slots", () => {
    // Charts list the same player at `WR` and at `KR`, or at `RB` and `HB`. The highest place his
    // club gave him anywhere is the claim it is making about him.
    const mapped = mapDepthChart(
      [row({ depth_team: "3", depth_position: "KR" }), row({ depth_team: "1", depth_position: "WR" })],
      projected,
      2023,
      AS_OF,
    );
    expect(mapped.observations).toHaveLength(1);
    expect(mapped.observations[0]!.value).toBe(1);
  });

  it("names everyone the universe does not project rather than silently dropping him", () => {
    const mapped = mapDepthChart([row({ gsis_id: "00-9999999" })], projected, 2023, AS_OF);
    expect(mapped.observations).toEqual([]);
    expect(mapped.unknownPlayers).toEqual(["00-9999999"]);
  });

  it("THROWS ON A MISSING COLUMN, because a silently empty feed looks like a feed that says nothing", () => {
    const withoutFormation: CsvRow = Object.fromEntries(
      Object.entries(row({})).filter(([column]) => column !== "formation"),
    );
    expect(() => mapDepthChart([withoutFormation], projected, 2023, AS_OF)).toThrow(/formation column/);
  });

  it("ignores a row whose depth is the whitespace sentinel the published file carries", () => {
    const mapped = mapDepthChart([row({ depth_team: "\\n    " })], projected, 2023, AS_OF);
    expect(mapped.observations).toEqual([]);
  });
});

describe("mapDepthChart, the dated schema (2026 onward)", () => {
  const projected = new Set(["00-0000001", "00-0000002"]);
  const CUTOFF = new Date("2026-09-10T00:19:59.999Z"); // one millisecond before kickoff

  function datedRow(over: Partial<CsvRow>): CsvRow {
    return {
      dt: "2026-08-31T14:44:50Z",
      team: "ARI",
      player_name: "Someone",
      espn_id: "1",
      gsis_id: "00-0000001",
      pos_grp_id: "15",
      pos_grp: "3WR 1TE",
      pos_id: "9",
      pos_name: "Quarterback",
      pos_abb: "QB",
      pos_slot: "9",
      pos_rank: "1",
      ...over,
    };
  }

  it("keeps only the offensive personnel group and the latest snapshot at or before the cutoff", () => {
    const mapped = mapDepthChart(
      [
        datedRow({}),
        datedRow({ dt: "2026-08-30T12:30:54Z", gsis_id: "00-0000002", pos_rank: "9" }), // stale snapshot, dropped
        datedRow({ pos_grp: "Base 4-3 D", gsis_id: "00-0000002" }), // defence, dropped
        datedRow({ pos_grp: "Special Teams", gsis_id: "00-0000002" }), // special teams, dropped
      ],
      projected,
      2026,
      CUTOFF,
    );
    // Task 3, ruling B: stamped at the SNAPSHOT'S OWN `dt` (the real publication instant), not at
    // CUTOFF — see the dedicated describe block below for the case that makes this unambiguous.
    expect(mapped.observations).toEqual([
      {
        season: 2026,
        week: 1,
        playerId: "00-0000001",
        source: DEPTH_SOURCE,
        metric: DEPTH_METRIC,
        value: 1,
        asOf: new Date("2026-08-31T14:44:50Z"),
      },
    ]);
  });

  it("ignores a snapshot dated after the cutoff, exactly as the legacy path never sees a future week", () => {
    const mapped = mapDepthChart(
      [datedRow({ dt: "2026-09-15T00:00:00Z" })], // after kickoff, must not be readable
      projected,
      2026,
      CUTOFF,
    );
    expect(mapped.observations).toEqual([]);
  });

  it("picks the LATEST snapshot at or before the cutoff, not the earliest", () => {
    const mapped = mapDepthChart(
      [
        datedRow({ dt: "2026-04-01T00:00:00Z", pos_rank: "3" }), // an early-offseason snapshot
        datedRow({ dt: "2026-08-31T14:44:50Z", pos_rank: "1" }), // the closest one to kickoff
      ],
      projected,
      2026,
      CUTOFF,
    );
    expect(mapped.observations).toHaveLength(1);
    expect(mapped.observations[0]!.value).toBe(1);
    expect(mapped.observations[0]!.asOf).toEqual(new Date("2026-08-31T14:44:50Z"));
  });

  it("STAMPS AT THE SNAPSHOT'S OWN dt, NOT at the cutoff (Task 3, ruling B)", () => {
    // The cutoff (one millisecond before kickoff) and the snapshot's real publication instant are
    // deliberately far apart here, so a stamp of CUTOFF and a stamp of the real dt cannot be
    // confused for each other by coincidence.
    const dt = "2026-08-20T09:15:00Z";
    const mapped = mapDepthChart([datedRow({ dt })], projected, 2026, CUTOFF);
    expect(mapped.observations).toHaveLength(1);
    expect(mapped.observations[0]!.asOf).toEqual(new Date(dt));
    expect(mapped.observations[0]!.asOf.getTime()).not.toBe(CUTOFF.getTime());
    expect(mapped.observations[0]!.asOf.getTime()).toBeLessThan(CUTOFF.getTime());
  });

  it("KEEPS A MAN'S BEST RANK where the offensive group lists him more than once", () => {
    const mapped = mapDepthChart(
      [datedRow({ pos_abb: "FB", pos_rank: "3" }), datedRow({ pos_abb: "RB", pos_rank: "1" })],
      projected,
      2026,
      CUTOFF,
    );
    expect(mapped.observations).toHaveLength(1);
    expect(mapped.observations[0]!.value).toBe(1);
  });

  it("names everyone the universe does not project rather than silently dropping him", () => {
    const mapped = mapDepthChart([datedRow({ gsis_id: "00-9999999" })], projected, 2026, CUTOFF);
    expect(mapped.observations).toEqual([]);
    expect(mapped.unknownPlayers).toEqual(["00-9999999"]);
  });

  it("THROWS ON A MISSING COLUMN, because a silently empty feed looks like a feed that says nothing", () => {
    const withoutPosGrp: CsvRow = Object.fromEntries(Object.entries(datedRow({})).filter(([column]) => column !== "pos_grp"));
    expect(() => mapDepthChart([withoutPosGrp], projected, 2026, CUTOFF)).toThrow(/pos_grp column/);
  });

  it("ignores a row whose rank is not a positive number", () => {
    const mapped = mapDepthChart([datedRow({ pos_rank: "not-a-number" })], projected, 2026, CUTOFF);
    expect(mapped.observations).toEqual([]);
  });
});

describe("mapDepthChart, schema dispatch", () => {
  it("THROWS when a file matches neither the legacy nor the dated schema, rather than silently reading nothing", () => {
    const alienRow: CsvRow = { season: "2027", team: "ARI", some_new_column: "x" };
    expect(() => mapDepthChart([alienRow], new Set(), 2027, AS_OF)).toThrow(/matches neither/);
  });

  it("returns an empty result for an empty file without inspecting columns", () => {
    expect(mapDepthChart([], new Set(), 2026, AS_OF)).toEqual({ observations: [], unknownPlayers: [] });
  });
});

describe("depthMultiplier", () => {
  it("is bounded, so a thin cell cannot make a third-stringer a starter", () => {
    const wild: DepthPriors = { ...PRIORS, bySnapShare: { ...PRIORS.bySnapShare, QB: { first: 40, second: 0.001, third: 1, offChart: 1 } } };
    expect(depthMultiplier("QB", "first", wild)).toBe(2);
    expect(depthMultiplier("QB", "second", wild)).toBe(0.5);
  });

  it("passes a player through untouched where the fit had nothing to say", () => {
    const silent: DepthPriors = { ...PRIORS, bySnapShare: { ...PRIORS.bySnapShare, K: { first: 1, second: 1, third: 1, offChart: 1 } } };
    for (const rank of DEPTH_RANKS) expect(depthMultiplier("K", rank, silent)).toBe(1);
  });
});

describe("applyDepthChart", () => {
  const positions = new Map<string, Position>([["qb1", "QB"], ["qb2", "QB"], ["unlisted", "WR"]]);
  const chart: DepthChart = new Map([["qb1", "first"], ["qb2", "second"]]);
  const opportunity = new Map([
    ["qb1", predicted("qb1", 0.5)],
    ["qb2", predicted("qb2", 0.5)],
    ["unlisted", predicted("unlisted", 0.5)],
  ]);

  it("SEPARATES A STARTER FROM HIS BACKUP, which is the whole of what the chart is for", () => {
    const adjusted = applyDepthChart(opportunity, chart, positions, PRIORS);
    expect(adjusted.get("qb1")!.snapShare).toBeCloseTo(0.75, 10);
    expect(adjusted.get("qb2")!.snapShare).toBeCloseTo(0.3, 10);
  });

  it("scales the whole line, because everything a player does scales with being on the field", () => {
    const adjusted = applyDepthChart(opportunity, chart, positions, PRIORS);
    expect(adjusted.get("qb2")!.passAttemptShare).toBeCloseTo(0.3, 10);
    expect(adjusted.get("qb2")!.targetShare).toBeCloseTo(0.12, 10);
    // Team volume is a property of the offence and is never touched by a claim about one player.
    expect(adjusted.get("qb2")!.teamPassAttempts).toBe(34);
  });

  it("treats absence from the chart as its own cell rather than as no opinion", () => {
    // The receiver cell is 0.4 and the bound floors a multiplier at 0.5, so 0.5 of 0.5 is 0.25.
    const adjusted = applyDepthChart(opportunity, chart, positions, PRIORS);
    expect(adjusted.get("unlisted")!.snapShare).toBeCloseTo(0.25, 10);
  });

  it("never lets a share leave the unit interval", () => {
    const huge = new Map([["qb1", predicted("qb1", 0.95)]]);
    const adjusted = applyDepthChart(huge, chart, positions, PRIORS);
    expect(adjusted.get("qb1")!.snapShare).toBe(1);
  });
});
