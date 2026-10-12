import { describe, expect, it } from "vitest";
import { PPR_SCORING } from "@research/domain/scoring";
import { computeFantasyPoints } from "@research/scoring/compute";
import type { Position } from "@research/domain/player";
import { parseCsv } from "./csv";
import { readFixture } from "./fixtures";
import { weekAsOfFromSnapCounts, NFLVERSE_SOURCE, SNAP_COUNT_ASSET_FLOOR } from "./map";
import { buildPlayerUniverse, mapNflPlayers } from "./players";
import { mapStatLines, statLineObservations, LIVE_ADMITTED_DERIVED_SEASONS, STAT_LINE_GAPS } from "./stat-lines";

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

/**
 * THE CROSSWALK CLASS AT THE STAT-LINE SEAM (fit-round Task 1).
 *
 * `mapStatLines` used to gate on the weekly file's own `position` column before the universe was
 * consulted, so a published stat line whose spelling disagreed with `nfl_players.position` never
 * became a row. Trent Richardson's whole 2012 rookie season is the loudest instance and the fullback
 * is the largest class; both are rebuilt here from the shape the real files publish.
 */
describe("mapStatLines narrows through the universe, never through the file's position column", () => {
  const classUniverse = buildPlayerUniverse([
    { id: "00-0029675", pfrId: "RichTr00", espnId: null, name: "Trent Richardson", position: "RB", latestTeam: "IND", rookieSeason: 2012, lastSeason: 2014 },
    { id: "00-0020270", pfrId: "NealLo00", espnId: null, name: "Lorenzo Neal", position: "FB", latestTeam: "SD", rookieSeason: 1993, lastSeason: 2008 },
    { id: "00-0000777", pfrId: "CentAa00", espnId: null, name: "A Centre", position: "C", latestTeam: "BUF", rookieSeason: 2012, lastSeason: 2012 },
  ]);
  const weekAsOf = new Map([[1, new Date("2012-09-11T00:00:00.000Z")]]);
  /** One published weekly row, with only the columns this mapper reads. */
  function row(playerId: string, position: string, rushingYards: string) {
    return { player_id: playerId, player_display_name: "n/a", position, season: "2012", week: "1", season_type: "REG", rushing_yards: rushingYards };
  }

  function idsFrom(rows: readonly ReturnType<typeof row>[]) {
    return mapStatLines({ playerWeek: rows, weekAsOf, universe: classUniverse }).statLines.map((line) => line.line.playerId);
  }

  it("keeps a published line whose position column is blank", () => {
    // The 2012 file publishes Richardson's fifteen weeks with an empty `position`. Fifteen weeks of
    // a third overall pick's rookie season were silently absent from the store because of it.
    expect(idsFrom([row("00-0029675", "", "109")])).toEqual(["00-0029675"]);
  });

  it("keeps a fullback, whom projectedPosition scores as a running back", () => {
    expect(idsFrom([row("00-0020270", "FB", "41")])).toEqual(["00-0020270"]);
  });

  it("still drops a centre, whom the universe does not project", () => {
    expect(idsFrom([row("00-0000777", "C", "0")])).toEqual([]);
  });

  it("counts only projectable people in the resolution rate, so the number keeps its meaning", () => {
    const result = mapStatLines({
      playerWeek: [row("00-0029675", "", "109"), row("00-0020270", "FB", "41"), row("00-0000777", "C", "0")],
      weekAsOf,
      universe: classUniverse,
    });
    expect(result.resolutionRate).toBe(1);
    expect(result.unresolved).toEqual([]);
  });
});

/**
 * THE PER-SEASON SOURCE DECISION, PINNED (discovery-expansion Task 1). Which seasons are read from
 * the published feed and which are derived from play-by-play is not a preference, it is a per-season
 * fact about what nflverse released, audited by `HEAD` before any of it was ingested. These
 * assertions are what stops a later round from "extending the gap list" to a season that has a
 * published file sitting right there.
 */
describe("the 2003-2012 history extension's branch decisions", () => {
  it("derives none of 2003-2012: every one of those seasons has published weekly stats upstream", () => {
    const extension = Array.from({ length: 10 }, (_, index) => 2003 + index);
    expect(extension.filter((season) => STAT_LINE_GAPS.includes(season))).toEqual([]);
  });

  it("keeps the gap list to the two seasons nflverse genuinely never published", () => {
    expect([...STAT_LINE_GAPS]).toEqual([2019, 2025]);
  });

  it("holds the snap-count floor above the whole extension, which is why those seasons land no participation", () => {
    // The other half of the audit: weekly stats reach back to 1999, snap-count ROWS only to 2013
    // (2011 and older 404, 2012 published and header-only). Every season of the extension is
    // therefore stat lines only, 2012 included, and this is the constant that says so.
    expect(SNAP_COUNT_ASSET_FLOOR).toBe(2013);
    expect(2012).toBeLessThan(SNAP_COUNT_ASSET_FLOOR);
  });

  it("admits none of the extension to a live board, which still only ever sees the current gap season", () => {
    expect([...LIVE_ADMITTED_DERIVED_SEASONS]).toEqual([2025]);
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
