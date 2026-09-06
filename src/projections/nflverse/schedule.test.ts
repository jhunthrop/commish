import { describe, expect, it } from "vitest";
import type { CsvRow } from "./csv";
import {
  kickoffAsOf,
  mapSchedule,
  pointsAllowedObservations,
  schedulePublishedAsOf,
  scheduleObservations,
  weekAsOfFromSchedule,
  SCHEDULE_METRICS,
  SCHEDULE_SOURCE,
} from "./schedule";

function game(over: Partial<Record<string, string>> = {}): CsvRow {
  return {
    game_type: "REG",
    season: "2024",
    week: "6",
    gameday: "2024-10-13",
    home_team: "BUF",
    away_team: "CLE",
    home_score: "31",
    away_score: "17",
    home_rest: "7",
    away_rest: "6",
    home_coach: "Sean McDermott",
    away_coach: "Kevin Stefanski",
    spread_line: "6.5",
    total_line: "44",
    div_game: "0",
    roof: "outdoors",
    temp: "58",
    wind: "9",
    ...over,
  };
}

describe("mapSchedule", () => {
  it("yields one row per team, each seeing the game from its own side", () => {
    const [home, away] = mapSchedule([game()], [2024]);
    expect(home).toMatchObject({ team: "BUF", opponent: "CLE", home: true, restDays: 7, pointsFor: 31, pointsAgainst: 17 });
    expect(away).toMatchObject({ team: "CLE", opponent: "BUF", home: false, restDays: 6, pointsFor: 17, pointsAgainst: 31 });
  });

  it("flips the spread for the away team, so positive always means THIS team is favoured", () => {
    // The file states the line from the home team's point of view. A consumer that read it raw
    // would have every underdog and favourite backwards for half the league, every week.
    const [home, away] = mapSchedule([game()], [2024]);
    expect(home!.pointSpread).toBe(6.5);
    expect(away!.pointSpread).toBe(-6.5);
  });

  it("treats a closed roof and a dome as indoors, and an open retractable roof as outdoors", () => {
    const of = (roof: string) => mapSchedule([game({ roof })], [2024])[0]!.indoors;
    expect(of("dome")).toBe(true);
    expect(of("closed")).toBe(true);
    expect(of("open")).toBe(false);
    expect(of("outdoors")).toBe(false);
  });

  it("keeps only the regular season and only the seasons asked for", () => {
    expect(mapSchedule([game({ game_type: "POST" })], [2024])).toEqual([]);
    expect(mapSchedule([game()], [2023])).toEqual([]);
  });

  it("carries a game with no result yet, with nulls rather than zeros for what has not happened", () => {
    const [home] = mapSchedule([game({ home_score: "", away_score: "" })], [2024]);
    expect(home!.pointsFor).toBeNull();
    expect(home!.pointsAgainst).toBeNull();
  });
});

describe("kickoffAsOf", () => {
  it("stamps the end of the game's UTC day plus the lag, never the bare date", () => {
    // A Monday night game finishes after midnight UTC. Stamping from the date itself would claim a
    // fact was knowable hours before the game that produced it had ended.
    expect(kickoffAsOf("2024-10-13", 24)).toEqual(new Date("2024-10-15T00:00:00.000Z"));
  });

  it("refuses a date it cannot read rather than stamping something plausible", () => {
    expect(() => kickoffAsOf("October 13", 24)).toThrow(/readable gameday/);
  });
});

describe("scheduleObservations — the two stamps that make the point-in-time claim honest", () => {
  const rows = scheduleObservations(mapSchedule([game()], [2024]));
  const find = (metric: string) => rows.find((row) => row.team === "BUF" && row.metric === metric)!;

  it("stamps rest, venue and opponent facts at schedule publication, months before the game", () => {
    expect(find(SCHEDULE_METRICS.restDays).asOf).toEqual(schedulePublishedAsOf(2024));
    expect(find(SCHEDULE_METRICS.restDays).source).toBe(SCHEDULE_SOURCE.schedule);
    expect(find(SCHEDULE_METRICS.indoors).asOf).toEqual(schedulePublishedAsOf(2024));
  });

  it("stamps the closing line and the recorded weather at kickoff, where they really became knowable", () => {
    // This is the constraint that decides whether game script is measurable at all, and it is
    // recorded here rather than argued about later. A week-6 projection is replayed from the moment
    // week 5's numbers landed, so it can read the rest days and cannot read this.
    expect(find(SCHEDULE_METRICS.pointSpread).asOf).toEqual(kickoffAsOf("2024-10-13", 24));
    expect(find(SCHEDULE_METRICS.pointSpread).source).toBe(SCHEDULE_SOURCE.kickoff);
    expect(find(SCHEDULE_METRICS.temperature).asOf).toEqual(kickoffAsOf("2024-10-13", 24));
  });

  it("decomposes the total and the spread into this team's own implied score", () => {
    expect(find(SCHEDULE_METRICS.impliedTeamTotal).value).toBeCloseTo(44 / 2 + 6.5 / 2, 10);
    const away = rows.find((row) => row.team === "CLE" && row.metric === SCHEDULE_METRICS.impliedTeamTotal)!;
    expect(away.value).toBeCloseTo(44 / 2 - 6.5 / 2, 10);
  });

  it("emits no weather row for a game that recorded none, rather than a row saying zero wind", () => {
    const indoors = scheduleObservations(mapSchedule([game({ roof: "dome", temp: "", wind: "" })], [2024]));
    expect(indoors.map((row) => row.metric)).not.toContain(SCHEDULE_METRICS.windSpeed);
  });

  /**
   * I5 (fix round): the kickoff-instant metric is the ONE fact `firstKickoffFor` (`team-store.ts`)
   * is allowed to read a season's first kickoff from, precisely BECAUSE it does not depend on a
   * betting line existing — unlike `pointSpread`, which a real game can legitimately carry none of.
   */
  it("stamps the kickoff-instant metric for EVERY scheduled game, even one with no betting line at all", () => {
    const lineless = scheduleObservations(mapSchedule([game({ spread_line: "", total_line: "" })], [2024]));
    const row = lineless.find((r) => r.team === "BUF" && r.metric === SCHEDULE_METRICS.kickoffInstant)!;
    expect(row.asOf).toEqual(kickoffAsOf("2024-10-13", 24));
    expect(row.source).toBe(SCHEDULE_SOURCE.kickoff);
    // And, unlike `pointSpread`, it is there even though this game carries no line.
    expect(lineless.some((r) => r.team === "BUF" && r.metric === SCHEDULE_METRICS.pointSpread)).toBe(false);
  });

  /**
   * POINTS ALLOWED (the 2026-09-05 kicker and team defence round) — the one input a team defence's
   * tier points cannot get anywhere else. The store held only each game's RESULT before this.
   */
  it("records each team's points allowed from the OTHER team's score", () => {
    expect(find(SCHEDULE_METRICS.pointsAllowed).value).toBe(17);
    expect(rows.find((row) => row.team === "CLE" && row.metric === SCHEDULE_METRICS.pointsAllowed)!.value).toBe(31);
  });

  it("stamps points allowed after the game, the class every preseason read refuses", () => {
    expect(find(SCHEDULE_METRICS.pointsAllowed).asOf).toEqual(kickoffAsOf("2024-10-13", 24));
    expect(find(SCHEDULE_METRICS.pointsAllowed).source).toBe(SCHEDULE_SOURCE.kickoff);
  });

  it("emits no points-allowed row for an unplayed game, rather than a zero nobody can tell from a shutout", () => {
    const unplayed = scheduleObservations(mapSchedule([game({ home_score: "", away_score: "" })], [2024]));
    expect(unplayed.map((row) => row.metric)).not.toContain(SCHEDULE_METRICS.pointsAllowed);
    expect(unplayed.map((row) => row.metric)).not.toContain(SCHEDULE_METRICS.gameResult);
  });

  it("records a real shutout as a zero, which is a fact and not an absence", () => {
    const shutout = scheduleObservations(mapSchedule([game({ home_score: "24", away_score: "0" })], [2024]));
    expect(shutout.find((row) => row.team === "BUF" && row.metric === SCHEDULE_METRICS.pointsAllowed)!.value).toBe(0);
  });

  it("narrows the backfill write to exactly the metric being added", () => {
    const only = pointsAllowedObservations(mapSchedule([game()], [2024]));
    expect(new Set(only.map((row) => row.metric))).toEqual(new Set([SCHEDULE_METRICS.pointsAllowed]));
    expect(only).toHaveLength(2);
  });
});

/**
 * The stamp a pre-2012 stat line is dated from — the seasons the 2003-2012 extension ingests have
 * published weekly stats and no snap-count file to borrow a game date from (`SNAP_COUNT_ASSET_FLOOR`).
 */
describe("weekAsOfFromSchedule", () => {
  const week = (over: Partial<Record<string, string>>): CsvRow => game({ season: "2010", ...over });

  it("dates a week from its LAST game, exactly as weekAsOfFromSnapCounts does", () => {
    const games = mapSchedule(
      [
        week({ week: "1", gameday: "2010-09-09" }),
        week({ week: "1", gameday: "2010-09-13" }),
        week({ week: "1", gameday: "2010-09-12" }),
      ],
      [2010],
    );
    expect(weekAsOfFromSchedule(games).get(1)).toEqual(kickoffAsOf("2010-09-13", 24));
  });

  it("keeps every week separate, and knows nothing about a week that was never played", () => {
    const games = mapSchedule([week({ week: "1", gameday: "2010-09-12" }), week({ week: "2", gameday: "2010-09-19" })], [2010]);
    const asOf = weekAsOfFromSchedule(games);
    expect(asOf.get(1)).toEqual(kickoffAsOf("2010-09-12", 24));
    expect(asOf.get(2)).toEqual(kickoffAsOf("2010-09-19", 24));
    expect(asOf.get(3)).toBeUndefined();
  });
});
