import { describe, expect, it } from "vitest";
import { parseCsv, type CsvRow } from "./csv";
import { readFixture } from "./fixtures";
import { buildPlayerUniverse, mapNflPlayers } from "./players";
import { CONTINUITY_METRICS, lineContinuityObservations, mapPlayerTeams } from "./team-map";

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
