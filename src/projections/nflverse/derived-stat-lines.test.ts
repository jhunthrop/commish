import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import type { SeasonStatLine } from "../lines";
import type { CsvRow } from "./csv";
import {
  DERIVED_STAT_LINE_SOURCE,
  DerivedStatLineAggregator,
  deriveStatLines,
  derivedStatLineObservations,
  seasonPointsAgreement,
} from "./derived-stat-lines";

/** A neutral first-down rush from midfield, which every test then varies one field of. */
function rush(over: Partial<Record<string, string>> = {}): CsvRow {
  return {
    season: "2018",
    week: "3",
    season_type: "REG",
    game_date: "2018-09-22",
    play_type: "run",
    rush_attempt: "1",
    qb_kneel: "0",
    two_point_attempt: "0",
    rusher_player_id: "back",
    rushing_yards: "4",
    rush_touchdown: "0",
    passer_player_id: "",
    passing_yards: "",
    pass_touchdown: "0",
    interception: "0",
    receiver_player_id: "",
    receiving_yards: "",
    complete_pass: "0",
    fumble_lost: "0",
    fumbled_1_player_id: "",
    ...over,
  };
}

function pass(over: Partial<Record<string, string>> = {}): CsvRow {
  return rush({
    play_type: "pass",
    rush_attempt: "0",
    rusher_player_id: "",
    rushing_yards: "",
    passer_player_id: "qb",
    passing_yards: "0",
    receiver_player_id: "wideout",
    receiving_yards: "0",
    ...over,
  });
}

function completion(over: Partial<Record<string, string>> = {}): CsvRow {
  return pass({ complete_pass: "1", passing_yards: "9", receiving_yards: "9", ...over });
}

function linesOf(rows: readonly CsvRow[]) {
  const aggregator = new DerivedStatLineAggregator();
  for (const row of rows) aggregator.add(row);
  return aggregator.lines();
}

const asOf = () => new Date("2018-09-24T00:00:00.000Z");

describe("DerivedStatLineAggregator — rushing", () => {
  it("credits a designed rush to the rusher", () => {
    const lines = linesOf([rush({ rushing_yards: "4" }), rush({ rushing_yards: "7" })]);
    expect(lines.find((l) => l.playerId === "back")).toMatchObject({ rushingYards: 11 });
  });

  it("counts a scramble as a rushing attempt, unlike the touches file's designed-carry definition", () => {
    const lines = linesOf([pass({ qb_scramble: "1", rush_attempt: "1", rusher_player_id: "qb", rushing_yards: "12" })]);
    expect(lines.find((l) => l.playerId === "qb")).toMatchObject({ rushingYards: 12 });
  });

  it("excludes a kneel — never a rushing attempt", () => {
    const lines = linesOf([rush({ qb_kneel: "1", rushing_yards: "-1" })]);
    expect(lines.find((l) => l.playerId === "back")).toBeUndefined();
  });

  it("counts a rushing touchdown", () => {
    const lines = linesOf([rush({ rush_touchdown: "1", rushing_yards: "2" })]);
    expect(lines.find((l) => l.playerId === "back")).toMatchObject({ rushingTouchdowns: 1 });
  });

  it("excludes a two-point conversion rush", () => {
    const lines = linesOf([rush({ two_point_attempt: "1", rushing_yards: "2" })]);
    expect(lines.find((l) => l.playerId === "back")).toBeUndefined();
  });
});

describe("DerivedStatLineAggregator — passing and receiving", () => {
  it("credits the passer's yards and the receiver's yards on the same completion", () => {
    const lines = linesOf([completion({ passing_yards: "9", receiving_yards: "9" })]);
    expect(lines.find((l) => l.playerId === "qb")).toMatchObject({ passingYards: 9 });
    expect(lines.find((l) => l.playerId === "wideout")).toMatchObject({ receivingYards: 9, receptions: 1 });
  });

  it("counts a target as no reception when the pass falls incomplete", () => {
    const lines = linesOf([pass({ complete_pass: "0" })]);
    expect(lines.find((l) => l.playerId === "wideout")).toMatchObject({ receptions: 0, receivingYards: 0 });
  });

  it("credits a passing touchdown to the passer and a receiving touchdown to the receiver on the same play", () => {
    const lines = linesOf([completion({ pass_touchdown: "1" })]);
    expect(lines.find((l) => l.playerId === "qb")).toMatchObject({ passingTouchdowns: 1 });
    expect(lines.find((l) => l.playerId === "wideout")).toMatchObject({ receivingTouchdowns: 1 });
  });

  it("credits an interception to the passer", () => {
    const lines = linesOf([pass({ interception: "1" })]);
    expect(lines.find((l) => l.playerId === "qb")).toMatchObject({ interceptions: 1 });
  });
});

describe("DerivedStatLineAggregator — fumbles", () => {
  it("credits one lost fumble to whoever fumbled, regardless of play type", () => {
    const lines = linesOf([rush({ fumble_lost: "1", fumbled_1_player_id: "back" })]);
    expect(lines.find((l) => l.playerId === "back")).toMatchObject({ fumblesLost: 1 });
  });

  it("does not credit a fumble with no attributed player", () => {
    const lines = linesOf([rush({ fumble_lost: "1", fumbled_1_player_id: "" })]);
    expect(lines.some((l) => l.fumblesLost > 0)).toBe(false);
  });
});

describe("deriveStatLines", () => {
  it("builds a StatLine with the five undeterminable fields at zero", () => {
    const lines = linesOf([rush({ rushing_yards: "5" })]);
    const { statLines } = deriveStatLines(lines, asOf, new Set(["back"]));
    expect(statLines[0]?.line).toMatchObject({
      playerId: "back",
      rushingYards: 5,
      fieldGoalsMade: 0,
      extraPointsMade: 0,
      sacks: 0,
      defensiveInterceptions: 0,
      defensiveTouchdowns: 0,
    });
  });

  it("stamps every field's finite-number invariant, and reports a player the universe cannot place", () => {
    const lines = linesOf([rush(), completion()]);
    const { statLines, unknownPlayers } = deriveStatLines(lines, asOf, new Set(["back"]));
    expect(statLines).toHaveLength(1);
    expect(unknownPlayers).toEqual(["qb", "wideout"]);
  });

  it("stamps every line with the moment the game that produced it finished", () => {
    const lines = linesOf([rush()]);
    const { statLines } = deriveStatLines(lines, asOf, new Set(["back"]));
    expect(statLines[0]?.asOf).toEqual(asOf());
  });
});

describe("derivedStatLineObservations", () => {
  it("emits one observation per stat field under the derived source, never the published one", () => {
    const lines = linesOf([rush({ rushing_yards: "5" })]);
    const { statLines } = deriveStatLines(lines, asOf, new Set(["back"]));
    const observations = derivedStatLineObservations(statLines);
    expect(observations).toHaveLength(14);
    expect(observations.every((row) => row.source === DERIVED_STAT_LINE_SOURCE)).toBe(true);
    expect(observations).toEqual(
      expect.arrayContaining([expect.objectContaining({ metric: "rushing_yards", value: 5 })]),
    );
  });
});

describe("seasonPointsAgreement", () => {
  const positions: ReadonlyMap<string, Position> = new Map([
    ["rb1", "RB"],
    ["rb2", "RB"],
  ]);

  function statLine(playerId: string, week: number, rushingYards: number, rushingTouchdowns: number): SeasonStatLine {
    return {
      season: 2018,
      asOf: new Date("2018-12-01T00:00:00.000Z"),
      line: {
        playerId,
        week,
        passingYards: 0,
        passingTouchdowns: 0,
        interceptions: 0,
        rushingYards,
        rushingTouchdowns,
        receivingYards: 0,
        receivingTouchdowns: 0,
        receptions: 0,
        fumblesLost: 0,
        fieldGoalsMade: 0,
        extraPointsMade: 0,
        sacks: 0,
        defensiveInterceptions: 0,
        defensiveTouchdowns: 0,
      },
    };
  }

  function season(playerId: string, weeklyYards: readonly number[]): readonly SeasonStatLine[] {
    return weeklyYards.map((yards, index) => statLine(playerId, index + 1, yards, 0));
  }

  it("scores 1 when the derivation and the published line agree on the ordering", () => {
    const published = [...season("rb1", Array(9).fill(80)), ...season("rb2", Array(9).fill(40))];
    const derived = [...season("rb1", Array(9).fill(81)), ...season("rb2", Array(9).fill(39))];
    const result = seasonPointsAgreement(derived, published, positions);
    expect(result.rankCorrelation).toBe(1);
    expect(result.sampleSize).toBe(2);
  });

  it("drops a player under the games floor from the sample", () => {
    const published = [...season("rb1", Array(9).fill(80)), ...season("rb2", Array(3).fill(40))];
    const derived = [...season("rb1", Array(9).fill(80)), ...season("rb2", Array(3).fill(40))];
    const result = seasonPointsAgreement(derived, published, positions, { minGames: 8 });
    expect(result.sampleSize).toBe(1);
  });

  it("ignores a player the position map does not carry", () => {
    const published = season("rb1", Array(9).fill(80));
    const derived = season("rb1", Array(9).fill(80));
    const result = seasonPointsAgreement(derived, published, new Map());
    expect(result.sampleSize).toBe(0);
    expect(result.rankCorrelation).toBeNull();
  });
});
