import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
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
