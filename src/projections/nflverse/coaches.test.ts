import { describe, expect, it } from "vitest";
import type { WeekRef } from "../team-context";
import { coachByTeamSeason, coachObservations, COACH_METRICS, seasonMeans } from "./coaches";
import { PBP_METRICS } from "./pbp";
import { schedulePublishedAsOf, type TeamGame } from "./schedule";

function game(over: Partial<TeamGame> & Pick<TeamGame, "season" | "week" | "team" | "coach">): TeamGame {
  return {
    opponent: "OPP",
    home: true,
    restDays: 7,
    indoors: false,
    divisionGame: false,
    pointsFor: 20,
    pointsAgainst: 17,
    pointSpread: null,
    totalLine: null,
    temperature: null,
    windSpeed: null,
    kickoffAsOf: new Date("2024-09-09T00:00:00.000Z"),
    ...over,
  };
}

function season(seasonYear: number, team: string, coach: string, weeks = 3): readonly TeamGame[] {
  return Array.from({ length: weeks }, (_, index) => game({ season: seasonYear, week: index + 1, team, coach }));
}

describe("coachByTeamSeason", () => {
  it("takes the coach who ran the most of a team's games, not the first one listed", () => {
    // An interim appointed in November did not set the offence's tendencies in September.
    const games = [
      ...season(2024, "CHI", "The Fired One", 10),
      ...Array.from({ length: 7 }, (_, index) => game({ season: 2024, week: index + 11, team: "CHI", coach: "The Interim" })),
    ];
    expect(coachByTeamSeason(games)).toEqual([{ season: 2024, team: "CHI", coach: "The Fired One" }]);
  });
});

describe("coachObservations", () => {
  /** A season-mean lookup over a flat table, keyed by team and season. */
  const paceOf: Record<string, number> = { "2022|SEA": 26, "2023|SEA": 27 };
  const seasonMean = (team: string, seasonYear: number, metric: string): number | null =>
    metric === PBP_METRICS.paceSecondsPerPlay ? (paceOf[`${seasonYear}|${team}`] ?? null) : null;

  const games = [
    ...season(2022, "SEA", "The Mover"),
    ...season(2023, "SEA", "The Mover"),
    ...season(2023, "TEN", "The Incumbent"),
    ...season(2024, "TEN", "The Mover"),
  ];

  it("reports zero tenure the season a coach arrives, and counts up while he stays", () => {
    const rows = coachObservations(games, seasonMean, [2023, 2024]);
    const tenure = (seasonYear: number, team: string) =>
      rows.find((row) => row.season === seasonYear && row.team === team && row.metric === COACH_METRICS.tenureSeasons)!.value;
    expect(tenure(2024, "TEN")).toBe(0);
    expect(tenure(2023, "SEA")).toBe(1);
  });

  it("carries the incoming coach's own pace from the teams he ran before, not from the team he joined", () => {
    const rows = coachObservations(games, seasonMean, [2024]);
    const prior = rows.find((row) => row.season === 2024 && row.team === "TEN" && row.metric === COACH_METRICS.priorPace)!;
    // The mean of his 2022 and 2023 Seattle offences: the fingerprint that travels with him.
    expect(prior.value).toBeCloseTo((26 + 27) / 2, 10);
  });

  it("emits no prior row for a coach we have no history of, rather than a league average in disguise", () => {
    const rows = coachObservations([...season(2024, "LV", "The Rookie Coach")], seasonMean, [2024]);
    expect(rows.map((row) => row.metric)).not.toContain(COACH_METRICS.priorPace);
    expect(rows.some((row) => row.metric === COACH_METRICS.tenureSeasons)).toBe(true);
  });

  it("stamps every row at schedule publication, months before a game and after every hire", () => {
    // Head coaching hires are complete by February and the schedule lands in May, so this is both
    // honest and early enough that week 1 — the week a coaching change matters most — can read it.
    const rows = coachObservations(games, seasonMean, [2024]);
    expect(rows.every((row) => row.asOf.getTime() === schedulePublishedAsOf(2024).getTime())).toBe(true);
  });

  it("writes one row per week, so no consumer has to special-case a season-keyed fact", () => {
    const rows = coachObservations(games, seasonMean, [2024]);
    const weeks = rows.filter((row) => row.metric === COACH_METRICS.tenureSeasons).map((row) => row.week);
    expect(weeks.sort()).toEqual([1, 2, 3]);
  });
});

describe("coachObservations with play-caller attribution", () => {
  const noPace: (team: string, seasonYear: number, metric: string) => number | null = () => null;
  const kcGames2024 = season(2024, "KC", "Andy Reid", 18);

  it("attributes a team-season to the play-caller, not the head coach, where the table covers it", () => {
    // games say KC's coach is "Andy Reid" all season; the table says Matt Nagy called plays wks 1-18
    const lookup = (team: string, seasonYear: number) => (team === "KC" && seasonYear === 2024 ? "Matt Nagy" : null);
    const rows = coachObservations(kcGames2024, noPace, [2024], lookup);
    const tenure = rows.find((r) => r.metric === COACH_METRICS.tenureSeasons);
    expect(tenure?.value).toBe(0); // Nagy's first season calling KC's plays => a coaching change
  });

  it("falls back to the head coach where the lookup answers null", () => {
    const rows = coachObservations(kcGames2024, noPace, [2024], () => null);
    const noLookup = coachObservations(kcGames2024, noPace, [2024]);
    expect(rows).toEqual(noLookup);
  });

  it("counts tenure across a role change for the same name", () => {
    // games.csv names a different head coach in 2022 (Josh McDaniels was only the OC that year); the
    // table attributes 2022's play-calling to him too. He becomes head coach himself in 2023-2024, so
    // games.csv and the table agree from then on. Same name, three straight seasons => tenure 2 in 2024.
    const games = [
      ...season(2022, "NE", "HC Original"),
      ...season(2023, "NE", "Josh McDaniels"),
      ...season(2024, "NE", "Josh McDaniels"),
    ];
    const lookup = (team: string, seasonYear: number) =>
      team === "NE" && seasonYear === 2022 ? "Josh McDaniels" : null;
    const rows = coachObservations(games, noPace, [2024], lookup);
    const tenure = rows.find((r) => r.season === 2024 && r.team === "NE" && r.metric === COACH_METRICS.tenureSeasons);
    expect(tenure?.value).toBe(2);
  });
});

describe("seasonMeans", () => {
  it("averages only the weeks the store actually holds", () => {
    const read = (_team: string, at: WeekRef): number | null => (at.week <= 2 ? at.week * 10 : null);
    expect(seasonMeans(read, [1, 2, 3, 4])("SEA", 2024, PBP_METRICS.paceSecondsPerPlay)).toBe(15);
  });

  it("answers null for a season it has nothing for", () => {
    expect(seasonMeans(() => null, [1, 2])("SEA", 2024, PBP_METRICS.paceSecondsPerPlay)).toBeNull();
  });
});
