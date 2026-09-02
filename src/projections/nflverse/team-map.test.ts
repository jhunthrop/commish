import { describe, expect, it } from "vitest";
import { parseCsv, type CsvRow } from "./csv";
import { readFixture } from "./fixtures";
import { buildPlayerUniverse, mapNflPlayers } from "./players";
import { CONTINUITY_METRICS, lineContinuityObservations, mapPlayerTeams, mapPlayerTeamsFromWeeklyStats } from "./team-map";

const SNAP_COUNTS = parseCsv(readFixture("snap_counts_2024_buf_w1-3.csv"));
const universe = buildPlayerUniverse(mapNflPlayers(parseCsv(readFixture("players_slice.csv"))));

/** gsis id for Josh Allen the quarterback, matching `map.test.ts`. */
const ALLEN = "00-0034857";

describe("mapPlayerTeams", () => {
  it("records the offence a player took his snaps for, week by week", () => {
    const edges = mapPlayerTeams(SNAP_COUNTS, universe);
    const allen = edges.filter((edge) => edge.playerId === ALLEN).sort((a, b) => a.week - b.week);
    expect(allen.map((edge) => [edge.week, edge.team])).toEqual([[1, "BUF"], [2, "BUF"], [3, "BUF"]]);
  });

  it("stamps each edge with the end of the game that proves it, never earlier", () => {
    // A trade is only knowable to this engine once a snap has been taken for the new team. Stamping
    // earlier would mean reading a transaction wire we do not subscribe to.
    const edges = mapPlayerTeams(SNAP_COUNTS, universe);
    const week1 = edges.find((edge) => edge.playerId === ALLEN && edge.week === 1)!;
    expect(week1.asOf.getTime()).toBeGreaterThan(new Date("2024-09-08T00:00:00.000Z").getTime());
  });

  it("keeps only the positions the engine projects, matching the participation mapper", () => {
    const edges = mapPlayerTeams(SNAP_COUNTS, universe);
    // The snap-count file lists every position including the offensive line; an edge for a centre
    // is a row nothing downstream reads.
    expect(edges.length).toBeGreaterThan(0);
    expect(new Set(edges.map((edge) => edge.team))).toEqual(new Set(["BUF"]));
  });

  it("builds an edge for a fullback, whom the snap-count file spells FB and the engine scores as a back", () => {
    // The class fit-round Task 1 closed: the file's own `position` column used to gate these rows
    // before the universe was consulted, and `NFLVERSE_CONFIG.scoredPositions` never carried FB, so
    // every fullback in the league was missing from `player_week_teams` and from participation.
    const fullbackUniverse = buildPlayerUniverse([
      { id: "00-0031235", pfrId: "JuszKy00", espnId: null, name: "Kyle Juszczyk", position: "FB", latestTeam: "SF", rookieSeason: 2013, lastSeason: 2025 },
    ]);
    const row: CsvRow = {
      game_id: "2024_01_SF_SF",
      pfr_game_id: "202409090sfo",
      season: "2024",
      game_type: "REG",
      week: "1",
      player: "Kyle Juszczyk",
      pfr_player_id: "JuszKy00",
      position: "FB",
      team: "SF",
      offense_snaps: "22",
    };
    expect(mapPlayerTeams([row], fullbackUniverse)).toMatchObject([{ playerId: "00-0031235", team: "SF", week: 1 }]);
  });
});

/**
 * THE PRE-2013 ARM (fit-round Task 1). Below `SNAP_COUNT_ASSET_FLOOR` there is no snap-count file to
 * read a team off, and the store held a full set of published stat lines for 2003-2012 with no team
 * edge at all — the measured reason `incomingTeamWinTotal` read null for the whole extended decade.
 */
describe("mapPlayerTeamsFromWeeklyStats", () => {
  const oldDecadeUniverse = buildPlayerUniverse([
    { id: "00-0029675", pfrId: "RichTr00", espnId: null, name: "Trent Richardson", position: "RB", latestTeam: "IND", rookieSeason: 2012, lastSeason: 2014 },
    { id: "00-0000777", pfrId: "CentAa00", espnId: null, name: "A Centre", position: "C", latestTeam: "CLE", rookieSeason: 2012, lastSeason: 2012 },
  ]);
  const WEEK_AS_OF = new Map([
    [1, new Date("2012-09-11T00:00:00.000Z")],
    [2, new Date("2012-09-18T00:00:00.000Z")],
  ]);
  function weeklyRow(playerId: string, position: string, week: string, team: string): CsvRow {
    return { player_id: playerId, player_display_name: "n/a", position, season: "2012", week, season_type: "REG", team };
  }

  it("reads the offence off the published weekly file's own team column", () => {
    const edges = mapPlayerTeamsFromWeeklyStats(
      [weeklyRow("00-0029675", "", "1", "CLE"), weeklyRow("00-0029675", "", "2", "CLE")],
      2012,
      WEEK_AS_OF,
      oldDecadeUniverse,
    );
    expect(edges).toEqual([
      { season: 2012, week: 1, playerId: "00-0029675", team: "CLE", asOf: WEEK_AS_OF.get(1) },
      { season: 2012, week: 2, playerId: "00-0029675", team: "CLE", asOf: WEEK_AS_OF.get(2) },
    ]);
  });

  it("carries a midseason move, because the edge is per week and comes off the row he appears on", () => {
    const edges = mapPlayerTeamsFromWeeklyStats(
      [weeklyRow("00-0029675", "RB", "1", "CLE"), weeklyRow("00-0029675", "RB", "2", "IND")],
      2012,
      WEEK_AS_OF,
      oldDecadeUniverse,
    );
    expect(edges.map((edge) => [edge.week, edge.team])).toEqual([[1, "CLE"], [2, "IND"]]);
  });

  it("stamps from the week's own as-of, the same map the season's stat lines are dated from", () => {
    const [edge] = mapPlayerTeamsFromWeeklyStats([weeklyRow("00-0029675", "RB", "1", "CLE")], 2012, WEEK_AS_OF, oldDecadeUniverse);
    expect(edge!.asOf).toEqual(WEEK_AS_OF.get(1));
  });

  it("narrows to the projected positions the same way the snap-count arm does", () => {
    expect(mapPlayerTeamsFromWeeklyStats([weeklyRow("00-0000777", "C", "1", "CLE")], 2012, WEEK_AS_OF, oldDecadeUniverse)).toEqual([]);
  });

  it("ignores anything that is not a regular-season row", () => {
    const post = { ...weeklyRow("00-0029675", "RB", "1", "CLE"), season_type: "POST" };
    expect(mapPlayerTeamsFromWeeklyStats([post], 2012, WEEK_AS_OF, oldDecadeUniverse)).toEqual([]);
  });

  it("skips a week the schedule could not date rather than inventing a stamp for it", () => {
    // A fact whose as-of we had to invent is exactly the fact that later turns out to have leaked.
    expect(mapPlayerTeamsFromWeeklyStats([weeklyRow("00-0029675", "RB", "9", "CLE")], 2012, WEEK_AS_OF, oldDecadeUniverse)).toEqual([]);
  });

  it("skips a row with no team rather than writing an empty edge", () => {
    expect(mapPlayerTeamsFromWeeklyStats([weeklyRow("00-0029675", "RB", "1", "")], 2012, WEEK_AS_OF, oldDecadeUniverse)).toEqual([]);
  });
});

describe("lineContinuityObservations", () => {
  /** Five linemen, so a synthetic week is a whole line rather than a fragment of one. */
  function lineman(id: string, week: number, snaps: number, team = "KC"): CsvRow {
    return {
      game_type: "REG",
      season: "2024",
      week: String(week),
      team,
      position: "T",
      player: id,
      pfr_player_id: id,
      offense_snaps: String(snaps),
      pfr_game_id: `2024090${week}0kan`,
    };
  }

  function lineOf(week: number, ids: readonly string[]): readonly CsvRow[] {
    return ids.map((id, index) => lineman(id, week, 60 - index));
  }

  it("reports five carried over when the same five started again", () => {
    const rows = lineContinuityObservations(
      [...lineOf(1, ["a", "b", "c", "d", "e"]), ...lineOf(2, ["a", "b", "c", "d", "e"])],
      2024,
    );
    const carried = rows.find((row) => row.week === 2 && row.metric === CONTINUITY_METRICS.sameStarters)!;
    expect(carried.value).toBe(5);
  });

  it("reports the shortfall when a man is replaced", () => {
    const rows = lineContinuityObservations(
      [...lineOf(1, ["a", "b", "c", "d", "e"]), ...lineOf(2, ["a", "b", "c", "d", "f"])],
      2024,
    );
    expect(rows.find((row) => row.week === 2 && row.metric === CONTINUITY_METRICS.sameStarters)!.value).toBe(4);
    expect(rows.find((row) => row.week === 2 && row.metric === CONTINUITY_METRICS.startersUsed)!.value).toBe(6);
  });

  it("emits no carry-over row for week 1, because a zero there would read as five changes", () => {
    const rows = lineContinuityObservations(lineOf(1, ["a", "b", "c", "d", "e"]), 2024);
    expect(rows.filter((row) => row.metric === CONTINUITY_METRICS.sameStarters)).toEqual([]);
  });

  it("takes the five by snaps played, not by anything the file calls a start", () => {
    // A lineman who left in the first quarter did not really start; one who came in and played the
    // rest of the game did, whatever the pre-game sheet said.
    const week = [
      lineman("starter-hurt", 1, 8),
      lineman("a", 1, 60),
      lineman("b", 1, 59),
      lineman("c", 1, 58),
      lineman("d", 1, 57),
      lineman("replacement", 1, 52),
    ];
    const rows = lineContinuityObservations([...week, ...lineOf(2, ["a", "b", "c", "d", "replacement"])], 2024);
    expect(rows.find((row) => row.week === 2 && row.metric === CONTINUITY_METRICS.sameStarters)!.value).toBe(5);
  });
});
