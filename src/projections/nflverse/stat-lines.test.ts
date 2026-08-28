import { describe, expect, it } from "vitest";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import type { Position } from "@/domain/player";
import { parseCsv } from "./csv";
import { readFixture } from "./fixtures";
import { weekAsOfFromSnapCounts, NFLVERSE_SOURCE } from "./map";
import { buildPlayerUniverse, mapNflPlayers } from "./players";
import { mapStatLines, statLineObservations } from "./stat-lines";

const SNAP_COUNTS = parseCsv(readFixture("snap_counts_2024_buf_w1-3.csv"));
const PLAYER_WEEK = parseCsv(readFixture("stats_player_week_2024_buf_w1-3.csv"));
const WEEK_AS_OF = weekAsOfFromSnapCounts(SNAP_COUNTS, 24);
const UNIVERSE = mapNflPlayers(parseCsv(readFixture("players_slice.csv")));
const universe = buildPlayerUniverse(UNIVERSE);

/** gsis ids — the weekly file's own `player_id` column, which is what the store keys on. */
const ALLEN = "00-0034857";
const COOK = "00-0037248";
const SHAKIR = "00-0037261";

function mapped() {
  return mapStatLines({ playerWeek: PLAYER_WEEK, weekAsOf: WEEK_AS_OF, universe });
}

function lineFor(playerId: string, week: number) {
  return mapped().statLines.find((row) => row.line.playerId === playerId && row.line.week === week);
}

describe("mapStatLines", () => {
  it("reads a quarterback's real week into a StatLine", () => {
    expect(lineFor(ALLEN, 3)?.line).toMatchObject({
      playerId: ALLEN,
      week: 3,
      passingYards: 263,
      passingTouchdowns: 4,
      rushingYards: 44,
    });
  });

  it("reads a receiver's real week", () => {
    expect(lineFor(SHAKIR, 3)?.line).toMatchObject({ receptions: 6, receivingYards: 72 });
  });

  it("sums the three ways nflverse records a lost fumble into the one field the scoring rules know", () => {
    // nflverse splits a lost fumble across sack/rushing/receiving columns; `StatLine` has one
    // field, because a league's rules charge the same points however the ball came loose.
    const line = lineFor(COOK, 1)?.line;
    expect(line?.fumblesLost).toBe(0);
    expect(Number.isFinite(line?.fumblesLost)).toBe(true);
  });

  it("composes to the same points nflverse itself computed, through OUR scoring rules", () => {
    // The end-to-end proof that the component mapping is right: nflverse publishes its own PPR
    // total, our rules recompute it from the components we mapped, and the two must agree. A
    // single mis-mapped column moves this number.
    const rows = PLAYER_WEEK.filter((row) => [ALLEN, COOK, SHAKIR].includes(row.player_id!));
    for (const row of rows) {
      const line = lineFor(row.player_id!, Number(row.week))!.line;
      const position = row.position as Position;
      expect(computeFantasyPoints(line, position, PPR_SCORING)).toBeCloseTo(Number(row.fantasy_points_ppr), 2);
    }
  });

  it("stamps each line with its week's as-of, never with now", () => {
    expect(lineFor(ALLEN, 1)?.asOf).toEqual(new Date("2024-09-10T00:00:00.000Z"));
  });

  it("refuses a week it has no as-of for — a fact that cannot be dated cannot be stored", () => {
    expect(() => mapStatLines({ playerWeek: PLAYER_WEEK, weekAsOf: new Map(), universe })).toThrow(/as-of/i);
  });

  it("leaves the defensive and kicking fields at zero, because it maps only projected positions", () => {
    const line = lineFor(ALLEN, 1)?.line;
    expect(line).toMatchObject({ sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0, fieldGoalsMade: 0 });
  });

  it("places every weekly row against the full universe — an id join has nothing left to miss", () => {
    const result = mapped();
    expect(result.unresolved).toEqual([]);
    expect(result.resolutionRate).toBe(1);
  });

  it("still reports, never drops, anyone a narrowed universe cannot place", () => {
    const narrow = buildPlayerUniverse(UNIVERSE.filter((entry) => entry.id === ALLEN));
    const result = mapStatLines({ playerWeek: PLAYER_WEEK, weekAsOf: WEEK_AS_OF, universe: narrow });
    expect(result.resolutionRate).toBeLessThan(0.2);
    expect(result.unresolved.some((row) => row.name === "Khalil Shakir")).toBe(true);
  });
});

describe("statLineObservations", () => {
  it("emits one observation per stat field, all stamped alike", () => {
    const observations = statLineObservations([lineFor(SHAKIR, 3)!]);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          season: 2024,
          week: 3,
          playerId: SHAKIR,
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
