import { describe, expect, it } from "vitest";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import { computeFantasyPoints } from "@research-ts/scoring/compute";
import { STAT_FIELDS, type StatLine } from "@research-ts/domain/player";
import type { SeasonStatLine } from "../lines";
import { naiveProjection, NAIVE_SOURCE_NAME } from "./naive";

const ASOF = new Date("2024-01-01T00:00:00.000Z");

function seasonLine(season: number, week: number, playerId: string, over: Partial<StatLine> = {}): SeasonStatLine {
  return {
    season,
    asOf: ASOF,
    line: {
      playerId,
      week,
      ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
      ...over,
    },
  };
}

describe("naiveProjection", () => {
  it("projects each component as last season's per-game average", () => {
    const history = [
      seasonLine(2023, 1, "wr", { receptions: 4, receivingYards: 60 }),
      seasonLine(2023, 2, "wr", { receptions: 8, receivingYards: 100 }),
    ];

    expect(naiveProjection(history, { season: 2024, week: 5 })).toEqual([
      expect.objectContaining({ playerId: "wr", week: 5, receptions: 6, receivingYards: 80 }),
    ]);
  });

  it("IS last season's points per game once composed — which is what makes it the stated floor", () => {
    // Components are averaged rather than points, so the projection stays a `StatLine` and every
    // league's own rules compose it. `computeFantasyPoints` is linear in the components, so the
    // result is the same number a points-per-game benchmark would have produced directly.
    const history = [
      seasonLine(2023, 1, "rb", { rushingYards: 100, rushingTouchdowns: 2, receptions: 2 }),
      seasonLine(2023, 2, "rb", { rushingYards: 40, rushingTouchdowns: 0, receptions: 6 }),
    ];
    const perGamePoints =
      (computeFantasyPoints(history[0]!.line, "RB", PPR_SCORING) + computeFantasyPoints(history[1]!.line, "RB", PPR_SCORING)) / 2;

    const [projected] = naiveProjection(history, { season: 2024, week: 1 });

    expect(computeFantasyPoints(projected!, "RB", PPR_SCORING)).toBeCloseTo(perGamePoints, 2);
  });

  it("divides by games PLAYED, not by games scheduled", () => {
    // Points per game is the stated definition of the naive floor. Dividing by the seventeen games
    // a season holds would be points per SCHEDULED game — a different, much harsher number for
    // anyone who missed time, and a different benchmark than the one this claims to be.
    const history = [seasonLine(2023, 4, "te", { receptions: 10 })];
    expect(naiveProjection(history, { season: 2024, week: 1 })[0]?.receptions).toBe(10);
  });

  it("cannot see the season it is projecting — that is the whole point of a prior-season floor", () => {
    const history = [
      seasonLine(2023, 1, "wr", { receptions: 2 }),
      seasonLine(2024, 1, "wr", { receptions: 12 }),
    ];
    expect(naiveProjection(history, { season: 2024, week: 2 })[0]?.receptions).toBe(2);
  });

  it("cannot see two seasons back either", () => {
    const history = [seasonLine(2022, 1, "wr", { receptions: 12 })];
    expect(naiveProjection(history, { season: 2024, week: 2 })).toEqual([]);
  });

  it("has nothing to say about a rookie, and says nothing rather than guessing zero", () => {
    // The naive benchmark's own blind spot, and one the harness should show rather than paper
    // over: a projection of zero for every rookie would score as a confident, wrong opinion.
    const history = [seasonLine(2023, 1, "veteran", { receptions: 5 })];
    const projected = naiveProjection(history, { season: 2024, week: 1 });
    expect(projected.map((line) => line.playerId)).toEqual(["veteran"]);
  });

  it("stamps every projection with the week being projected", () => {
    const history = [seasonLine(2023, 9, "wr", { receptions: 5 })];
    expect(naiveProjection(history, { season: 2024, week: 12 })[0]?.week).toBe(12);
  });

  it("returns players in a stable order, so a scorecard is reproducible", () => {
    const history = [seasonLine(2023, 1, "b"), seasonLine(2023, 1, "a"), seasonLine(2023, 2, "b")];
    expect(naiveProjection(history, { season: 2024, week: 1 }).map((line) => line.playerId)).toEqual(["a", "b"]);
  });

  it("has a name, because a scoreboard line without one is unreadable", () => {
    expect(NAIVE_SOURCE_NAME).toBe("naive-prior-season-ppg");
  });

  it("projects nothing from nothing", () => {
    expect(naiveProjection([], { season: 2024, week: 1 })).toEqual([]);
  });
});
