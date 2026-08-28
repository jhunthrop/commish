import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import { buildCrosswalk, type CrosswalkPlayer } from "./crosswalk";
import { parseCsv, type CsvRow } from "./csv";
import { readFixture } from "./fixtures";
import {
  gameDayAsOf,
  mapParticipation,
  participationObservations,
  weekAsOfFromSnapCounts,
  NFLVERSE_SOURCE,
} from "./map";

const SNAP_COUNTS = parseCsv(readFixture("snap_counts_2024_buf_w1-3.csv"));
const PLAYER_WEEK = parseCsv(readFixture("stats_player_week_2024_buf_w1-3.csv"));

const player = (id: string, name: string, position: Position): CrosswalkPlayer => ({ id, name, position, nflTeam: "BUF" });

/** The four Bills the assertions below name, plus nobody else — so an unresolved report is easy to
 *  read and the resolution rate is a number this file controls rather than one the fixture sets. */
const ROSTER = [
  player("allen", "Josh Allen", "QB"),
  player("cook", "James Cook", "RB"),
  player("shakir", "Khalil Shakir", "WR"),
  player("kincaid", "Dalton Kincaid", "TE"),
];

const crosswalk = buildCrosswalk(ROSTER);

function participationFor(playerId: string, week: number, rows: readonly CsvRow[] = SNAP_COUNTS) {
  const { participation } = mapParticipation({ snapCounts: rows, playerWeek: PLAYER_WEEK, crosswalk });
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
    expect(participationFor("allen", 1)?.offensiveSnaps).toBe(62);
    expect(participationFor("cook", 2)?.offensiveSnaps).toBe(21);
  });

  it("takes the team denominator from the whole roster, linemen included", () => {
    // Buffalo ran 45 offensive snaps at Miami in week 2. Only a lineman played all of them, so a
    // denominator built from skill players alone would be short and every share would be inflated.
    expect(participationFor("cook", 2)?.teamOffensiveSnaps).toBe(45);
    expect(participationFor("allen", 3)?.teamOffensiveSnaps).toBe(64);
  });

  it("joins targets in from the weekly stats file", () => {
    expect(participationFor("shakir", 3)?.targets).toBe(6);
    expect(participationFor("cook", 1)?.targets).toBe(3);
  });

  it("reports routes run as null rather than zero — nflverse does not publish it", () => {
    expect(participationFor("shakir", 1)?.routesRun).toBeNull();
  });

  it("stamps every row with the week it belongs to, not with now", () => {
    expect(participationFor("allen", 1)?.asOf).toEqual(new Date("2024-09-10T00:00:00.000Z"));
  });

  it("keeps only the positions the engine projects", () => {
    const { participation } = mapParticipation({ snapCounts: SNAP_COUNTS, playerWeek: PLAYER_WEEK, crosswalk });
    expect(new Set(participation.map((row) => row.playerId))).toEqual(new Set(["allen", "cook", "shakir", "kincaid"]));
  });

  it("reports every skill player it could not resolve, and the rate", () => {
    const result = mapParticipation({ snapCounts: SNAP_COUNTS, playerWeek: PLAYER_WEEK, crosswalk });
    expect(result.unresolved.length).toBeGreaterThan(0);
    expect(result.unresolved.every((row) => row.occurrences >= 1)).toBe(true);
    // Four of Buffalo's skill players are on this roster; the rest of them are not.
    expect(result.resolutionRate).toBeGreaterThan(0);
    expect(result.resolutionRate).toBeLessThan(1);
  });

  it("resolves every skill player when the roster carries them all", () => {
    const everyone = buildCrosswalk(
      [...new Set(SNAP_COUNTS.filter((row) => ["QB", "RB", "WR", "TE"].includes(row.position!)).map((row) => row.player!))].map(
        (name, index) => ({ id: `p${index}`, name, position: "WR" as const, nflTeam: "BUF" }),
      ),
    );
    const result = mapParticipation({ snapCounts: SNAP_COUNTS, playerWeek: PLAYER_WEEK, crosswalk: everyone });
    expect(result.resolutionRate).toBe(1);
    expect(result.unresolved).toEqual([]);
  });

  it("ignores anything that is not a regular-season row", () => {
    const preseason = SNAP_COUNTS.map((row) => ({ ...row, game_type: "PRE" }));
    expect(mapParticipation({ snapCounts: preseason, playerWeek: PLAYER_WEEK, crosswalk }).participation).toEqual([]);
  });

  it("refuses a row whose snap count is not a number rather than reading it as zero", () => {
    const corrupt = SNAP_COUNTS.map((row) => (row.player === "Josh Allen" ? { ...row, offense_snaps: "" } : row));
    expect(() => mapParticipation({ snapCounts: corrupt, playerWeek: PLAYER_WEEK, crosswalk })).toThrow(/offense_snaps/);
  });
});

describe("participationObservations", () => {
  it("turns one participation row into the point-in-time observations that back it", () => {
    const row = participationFor("shakir", 3)!;
    const observations = participationObservations([row]);

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          season: 2024,
          week: 3,
          playerId: "shakir",
          source: NFLVERSE_SOURCE.snapCounts,
          metric: "offensive_snaps",
          value: 35,
          asOf: new Date("2024-09-25T00:00:00.000Z"),
        }),
        expect.objectContaining({ metric: "team_offensive_snaps", value: 64 }),
        expect.objectContaining({ metric: "targets", value: 6 }),
      ]),
    );
  });

  it("emits no row at all for a metric the feed does not carry — null is not zero", () => {
    const observations = participationObservations([participationFor("shakir", 3)!]);
    expect(observations.some((row) => row.metric === "routes_run")).toBe(false);
  });
});
