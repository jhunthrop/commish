import { describe, expect, it } from "vitest";
import { parseCsv, type CsvRow } from "./csv";
import { readFixture } from "./fixtures";
import {
  gameDayAsOf,
  mapParticipation,
  participationObservations,
  weekAsOfFromSnapCounts,
  NFLVERSE_SOURCE,
} from "./map";
import { buildPlayerUniverse, mapNflPlayers } from "./players";

const SNAP_COUNTS = parseCsv(readFixture("snap_counts_2024_buf_w1-3.csv"));
const PLAYER_WEEK = parseCsv(readFixture("stats_player_week_2024_buf_w1-3.csv"));
const UNIVERSE = mapNflPlayers(parseCsv(readFixture("players_slice.csv")));
const universe = buildPlayerUniverse(UNIVERSE);

/** gsis ids, because that is what the store now keys on. The quarterback Josh Allen, not the centre. */
const ALLEN = "00-0034857";
const COOK = "00-0037248";
const SHAKIR = "00-0037261";
const KINCAID = "00-0038933";

function participationFor(playerId: string, week: number, rows: readonly CsvRow[] = SNAP_COUNTS) {
  const { participation } = mapParticipation({ snapCounts: rows, playerWeek: PLAYER_WEEK, universe });
  return participation.find((row) => row.playerId === playerId && row.week === week);
}

describe("gameDayAsOf", () => {
  it("stamps a game the end of its own calendar day plus the publication lag", () => {
    // 202409080buf is Sunday 8 September 2024. The stamp is the END of that UTC day plus the lag,
    // never kickoff: a Monday night game finishes after midnight UTC, so stamping from the date
    // itself would put an `as_of` BEFORE the game it describes had even ended.
    expect(gameDayAsOf("202409080buf", 24)).toEqual(new Date("2024-09-10T00:00:00.000Z"));
  });

  it("refuses a game id it cannot read a date out of", () => {
    expect(() => gameDayAsOf("not-a-game-id", 24)).toThrow(/date/i);
  });
});

describe("weekAsOfFromSnapCounts", () => {
  it("dates each week from that week's last game", () => {
    const byWeek = weekAsOfFromSnapCounts(SNAP_COUNTS, 24);
    expect(byWeek.get(1)).toEqual(new Date("2024-09-10T00:00:00.000Z"));
    expect(byWeek.get(2)).toEqual(new Date("2024-09-14T00:00:00.000Z"));
    expect(byWeek.get(3)).toEqual(new Date("2024-09-25T00:00:00.000Z"));
  });
});

describe("mapParticipation", () => {
  it("reads a player's own offensive snaps", () => {
    expect(participationFor(ALLEN, 1)?.offensiveSnaps).toBe(62);
    expect(participationFor(COOK, 2)?.offensiveSnaps).toBe(21);
  });

  it("takes the team denominator from the whole roster, linemen included", () => {
    // Buffalo ran 45 offensive snaps at Miami in week 2. Only a lineman played all of them, so a
    // denominator built from skill players alone would be short and every share would be inflated.
    expect(participationFor(COOK, 2)?.teamOffensiveSnaps).toBe(45);
    expect(participationFor(ALLEN, 3)?.teamOffensiveSnaps).toBe(64);
  });

  it("joins targets in from the weekly stats file on the id both files carry", () => {
    expect(participationFor(SHAKIR, 3)?.targets).toBe(6);
    expect(participationFor(COOK, 1)?.targets).toBe(3);
  });

  it("does not confuse two men who share a name, because it never reads the name", () => {
    // The universe holds a Josh Allen who is a retired centre. A name join has to choose; the id
    // join places every Buffalo snap on the quarterback and none on the centre.
    const { participation } = mapParticipation({ snapCounts: SNAP_COUNTS, playerWeek: PLAYER_WEEK, universe });
    expect(participation.some((row) => row.playerId === "00-0030833")).toBe(false);
    expect(participation.filter((row) => row.playerId === ALLEN)).toHaveLength(3);
  });

  it("reads the other two opportunity numerators — carries and pass attempts", () => {
    expect(participationFor(COOK, 1)?.carries).toBe(19);
    expect(participationFor(ALLEN, 3)?.passAttempts).toBe(30);
    expect(participationFor(SHAKIR, 3)?.carries).toBe(0);
  });

  it("carries the team denominator for every share, not just for snaps", () => {
    // A share needs its own denominator. Team totals ride on each player's row rather than living
    // in a table of their own because the store has no team column — and that is a feature, not a
    // gap: a player traded midseason takes his new team's volume with him automatically, which a
    // team-keyed table would get wrong for exactly the players a model most needs to be right about.
    const cook = participationFor(COOK, 1)!;
    expect(cook.teamTargets).toBe(23);
    expect(cook.teamCarries).toBe(33);
    expect(cook.teamPassAttempts).toBe(23);
    expect(participationFor(SHAKIR, 3)?.teamTargets).toBe(30);
  });

  it("reports routes run as null rather than zero — nflverse does not publish it", () => {
    expect(participationFor(SHAKIR, 1)?.routesRun).toBeNull();
  });

  it("stamps every row with the week it belongs to, not with now", () => {
    expect(participationFor(ALLEN, 1)?.asOf).toEqual(new Date("2024-09-10T00:00:00.000Z"));
  });

  it("keeps only players the universe gives a projectable position", () => {
    const { participation } = mapParticipation({ snapCounts: SNAP_COUNTS, playerWeek: PLAYER_WEEK, universe });
    const positions = new Set(participation.map((row) => universe.byGsisId(row.playerId)!.position));
    expect(positions).toEqual(new Set(["QB", "RB", "WR", "TE"]));
    expect(new Set(participation.map((row) => row.playerId))).toContain(KINCAID);
  });

  it("places every skill player against the full universe — an id join has nothing left to miss", () => {
    const result = mapParticipation({ snapCounts: SNAP_COUNTS, playerWeek: PLAYER_WEEK, universe });
    expect(result.unresolved).toEqual([]);
    expect(result.resolutionRate).toBe(1);
  });

  it("still reports, never drops, anyone a narrowed universe cannot place", () => {
    // Absence is reported rather than dropped because an unresolved player is otherwise
    // indistinguishable from one who did not play, and a join quietly losing eight percent of
    // receivers looks like a lot of healthy scratches rather than like a bug.
    const narrow = buildPlayerUniverse(UNIVERSE.filter((player) => player.id === ALLEN));
    const result = mapParticipation({ snapCounts: SNAP_COUNTS, playerWeek: PLAYER_WEEK, universe: narrow });
    expect(result.resolutionRate).toBeLessThan(0.2);
    expect(result.unresolved.some((row) => row.name === "Khalil Shakir")).toBe(true);
    expect(result.unresolved.every((row) => row.occurrences >= 1)).toBe(true);
    expect(result.participation.every((row) => row.playerId === ALLEN)).toBe(true);
  });

  it("ignores anything that is not a regular-season row", () => {
    const preseason = SNAP_COUNTS.map((row) => ({ ...row, game_type: "PRE" }));
    expect(mapParticipation({ snapCounts: preseason, playerWeek: PLAYER_WEEK, universe }).participation).toEqual([]);
  });

  it("refuses a row whose snap count is not a number rather than reading it as zero", () => {
    const corrupt = SNAP_COUNTS.map((row) => (row.pfr_player_id === "AlleJo02" ? { ...row, offense_snaps: "" } : row));
    expect(() => mapParticipation({ snapCounts: corrupt, playerWeek: PLAYER_WEEK, universe })).toThrow(/offense_snaps/);
  });

  it("participates a fullback, whom the snap-count file spells FB and the engine scores as a back", () => {
    // The class fit-round Task 1 closed. The narrowing is the UNIVERSE's position now, not the
    // file's: `projectedPosition` maps FB to RB deliberately, so a man the file calls a fullback is
    // a running back to everything downstream and must not be dropped before resolution.
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
    const result = mapParticipation({ snapCounts: [row], playerWeek: [], universe: fullbackUniverse });
    expect(result.participation).toMatchObject([{ playerId: "00-0031235", week: 1, offensiveSnaps: 22 }]);
    expect(result.resolutionRate).toBe(1);
  });
});

describe("participationObservations", () => {
  it("turns one participation row into the point-in-time observations that back it", () => {
    const row = participationFor(SHAKIR, 3)!;
    const observations = participationObservations([row]);

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          season: 2024,
          week: 3,
          playerId: SHAKIR,
          source: NFLVERSE_SOURCE.snapCounts,
          metric: "offensive_snaps",
          value: 35,
          asOf: new Date("2024-09-25T00:00:00.000Z"),
        }),
        expect.objectContaining({ metric: "team_offensive_snaps", value: 64 }),
        expect.objectContaining({ metric: "targets", value: 6 }),
        expect.objectContaining({ metric: "team_targets", value: 30 }),
        expect.objectContaining({ metric: "carries", value: 0 }),
        expect.objectContaining({ metric: "team_carries", value: 29 }),
        expect.objectContaining({ metric: "pass_attempts", value: 0 }),
        expect.objectContaining({ metric: "team_pass_attempts", value: 31 }),
      ]),
    );
  });

  it("emits no row at all for a metric the feed does not carry — null is not zero", () => {
    const observations = participationObservations([participationFor(SHAKIR, 3)!]);
    expect(observations.some((row) => row.metric === "routes_run")).toBe(false);
  });
});
