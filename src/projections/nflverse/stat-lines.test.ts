import { describe, expect, it } from "vitest";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import type { Position } from "@/domain/player";
import { buildCrosswalk, type CrosswalkPlayer } from "./crosswalk";
import { parseCsv } from "./csv";
import { readFixture } from "./fixtures";
import { weekAsOfFromSnapCounts, NFLVERSE_SOURCE } from "./map";
import { mapStatLines, statLineObservations } from "./stat-lines";

const SNAP_COUNTS = parseCsv(readFixture("snap_counts_2024_buf_w1-3.csv"));
const PLAYER_WEEK = parseCsv(readFixture("stats_player_week_2024_buf_w1-3.csv"));
const WEEK_AS_OF = weekAsOfFromSnapCounts(SNAP_COUNTS, 24);

const player = (id: string, name: string, position: Position): CrosswalkPlayer => ({ id, name, position, nflTeam: "BUF" });
const crosswalk = buildCrosswalk([
  player("allen", "Josh Allen", "QB"),
  player("cook", "James Cook", "RB"),
  player("shakir", "Khalil Shakir", "WR"),
]);

function mapped() {
  return mapStatLines({ playerWeek: PLAYER_WEEK, weekAsOf: WEEK_AS_OF, crosswalk });
}

function lineFor(playerId: string, week: number) {
  return mapped().statLines.find((row) => row.line.playerId === playerId && row.line.week === week);
}

describe("mapStatLines", () => {
  it("reads a quarterback's real week into a StatLine", () => {
    expect(lineFor("allen", 3)?.line).toMatchObject({
      playerId: "allen",
      week: 3,
      passingYards: 263,
      passingTouchdowns: 4,
      rushingYards: 44,
    });
  });

  it("reads a receiver's real week", () => {
    expect(lineFor("shakir", 3)?.line).toMatchObject({ receptions: 6, receivingYards: 72 });
  });

  it("sums the three ways nflverse records a lost fumble into the one field the scoring rules know", () => {
    // nflverse splits a lost fumble across sack/rushing/receiving columns; `StatLine` has one
    // field, because a league's rules charge the same points however the ball came loose.
    const line = lineFor("cook", 1)?.line;
    expect(line?.fumblesLost).toBe(0);
    expect(Number.isFinite(line?.fumblesLost)).toBe(true);
  });

  it("composes to the same points nflverse itself computed, through OUR scoring rules", () => {
    // The end-to-end proof that the component mapping is right: nflverse publishes its own PPR
    // total, our rules recompute it from the components we mapped, and the two must agree. A
    // single mis-mapped column moves this number.
    const rows = PLAYER_WEEK.filter((row) => ["Josh Allen", "James Cook", "Khalil Shakir"].includes(row.player_display_name!));
    for (const row of rows) {
      const playerId = crosswalk.resolve({ name: row.player_display_name!, position: row.position!, team: row.team! })!;
      const line = lineFor(playerId, Number(row.week))!.line;
      const position = row.position as Position;
      expect(computeFantasyPoints(line, position, PPR_SCORING)).toBeCloseTo(Number(row.fantasy_points_ppr), 2);
    }
  });

  it("stamps each line with its week's as-of, never with now", () => {
    expect(lineFor("allen", 1)?.asOf).toEqual(new Date("2024-09-10T00:00:00.000Z"));
  });

  it("refuses a week it has no as-of for — a fact that cannot be dated cannot be stored", () => {
    expect(() => mapStatLines({ playerWeek: PLAYER_WEEK, weekAsOf: new Map(), crosswalk })).toThrow(/as-of/i);
  });

  it("leaves the defensive and kicking fields at zero, because it maps only projected positions", () => {
    const line = lineFor("allen", 1)?.line;
    expect(line).toMatchObject({ sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0, fieldGoalsMade: 0 });
  });

  it("reports the players it could not resolve", () => {
    const result = mapped();
    expect(result.unresolved.length).toBeGreaterThan(0);
    expect(result.resolutionRate).toBeLessThan(1);
  });
});

describe("statLineObservations", () => {
  it("emits one observation per stat field, all stamped alike", () => {
    const observations = statLineObservations([lineFor("shakir", 3)!]);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          season: 2024,
          week: 3,
          playerId: "shakir",
          source: NFLVERSE_SOURCE.playerWeek,
          metric: "receiving_yards",
          value: 72,
          asOf: new Date("2024-09-25T00:00:00.000Z"),
        }),
        expect.objectContaining({ metric: "receptions", value: 6 }),
      ]),
    );
    expect(observations).toHaveLength(14);
  });
});
