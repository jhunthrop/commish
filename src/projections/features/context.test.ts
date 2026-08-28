import { describe, expect, it } from "vitest";
import { SCHEDULE_METRICS, type TeamGame } from "../nflverse/schedule";
import type { TeamMetricLookup } from "../team-context";
import {
  CONTEXT_METRICS,
  defenceRatings,
  gameContextFor,
  opponentDefenceObservations,
  STANDARD_REST_DAYS,
  type DefenceWeek,
} from "./context";

const AS_OF = new Date("2024-09-16T00:00:00.000Z");

function defenceWeek(over: Partial<DefenceWeek> & Pick<DefenceWeek, "defence" | "offence" | "week">): DefenceWeek {
  return {
    season: 2024,
    passYardsAllowedPerDropback: 6.4,
    rushYardsAllowedPerCarry: 4.2,
    asOf: AS_OF,
    ...over,
  };
}

describe("defenceRatings — a defence that has faced four bad offences is not elite", () => {
  /**
   * Two defences allow exactly the same yardage. One did it against offences that torch everybody;
   * the other against offences nobody else can gain a yard on. The whole point of the adjustment is
   * that these are not the same defence, and every unadjusted "points allowed" table says they are.
   */
  const weeks: readonly DefenceWeek[] = [
    // The good offences, established by what they do to everybody else.
    ...[1, 2, 3].flatMap((week) => [
      defenceWeek({ defence: "SOFT-SCHEDULE", offence: "BAD-OFFENCE", week, passYardsAllowedPerDropback: 6 }),
      defenceWeek({ defence: "HARD-SCHEDULE", offence: "GOOD-OFFENCE", week, passYardsAllowedPerDropback: 6 }),
      defenceWeek({ defence: "PUNCHBAG-A", offence: "GOOD-OFFENCE", week, passYardsAllowedPerDropback: 9 }),
      defenceWeek({ defence: "PUNCHBAG-B", offence: "BAD-OFFENCE", week, passYardsAllowedPerDropback: 3 }),
    ]),
  ];

  it("rates the defence that held a good offence better than one that held a bad offence to the same number", () => {
    const ratings = defenceRatings(weeks);
    // A LOWER rating is a tougher defence: the number is "how much more than average is allowed".
    expect(ratings.get("HARD-SCHEDULE")!.pass).toBeLessThan(ratings.get("SOFT-SCHEDULE")!.pass);
  });

  it("puts an average defence at one, so the sign of any adjustment is readable", () => {
    const ratings = defenceRatings([
      defenceWeek({ defence: "A", offence: "B", week: 1 }),
      defenceWeek({ defence: "B", offence: "A", week: 1 }),
    ]);
    expect(ratings.get("A")!.pass).toBeCloseTo(1, 6);
    expect(ratings.get("A")!.rush).toBeCloseTo(1, 6);
  });

  it("shrinks a thin sample toward average rather than crowning a defence on one good week", () => {
    const oneWeek = defenceRatings([defenceWeek({ defence: "A", offence: "B", week: 1, passYardsAllowedPerDropback: 2 })]);
    // One game against one offence is the noisiest number in football, so it barely moves.
    expect(oneWeek.get("A")!.pass).toBeGreaterThan(0.9);
  });

  it("returns nothing at all rather than a rating of zero when there is no evidence", () => {
    expect(defenceRatings([]).size).toBe(0);
  });
});

describe("opponentDefenceObservations", () => {
  function game(week: number, team: string, opponent: string): TeamGame {
    return {
      season: 2024,
      week,
      team,
      opponent,
      home: true,
      restDays: 7,
      indoors: false,
      divisionGame: false,
      coach: "Somebody",
      pointsFor: null,
      pointsAgainst: null,
      pointSpread: null,
      totalLine: null,
      temperature: null,
      windSpeed: null,
      kickoffAsOf: new Date(`2024-09-${String(8 + week).padStart(2, "0")}T00:00:00.000Z`),
    };
  }

  const games = [1, 2, 3].flatMap((week) => [game(week, "OFFENCE", "DEFENCE"), game(week, "DEFENCE", "OFFENCE")]);
  const weeks = [1, 2].map((week) =>
    defenceWeek({ defence: "DEFENCE", offence: "OFFENCE", week, asOf: new Date(`2024-09-1${week}T00:00:00.000Z`) }),
  );

  it("gives a team the rating of the defence it faces, not of its own", () => {
    const rows = opponentDefenceObservations(games, weeks, [2024]);
    const forOffence = rows.filter((row) => row.team === "OFFENCE" && row.metric === CONTEXT_METRICS.opponentPassDefence);
    expect(forOffence.length).toBeGreaterThan(0);
  });

  it("stamps a rating with the last result that informed it, never with the game it describes", () => {
    // The opponent's identity is knowable in May and the results are not, so the later of the two
    // is the honest stamp — and it is exactly the moment the week is replayed from.
    const rows = opponentDefenceObservations(games, weeks, [2024]);
    const week3 = rows.find((row) => row.week === 3 && row.team === "OFFENCE")!;
    expect(week3.asOf).toEqual(new Date("2024-09-12T00:00:00.000Z"));
  });

  it("uses only results from BEFORE the week it is rating", () => {
    const rows = opponentDefenceObservations(games, weeks, [2024]);
    const week1 = rows.find((row) => row.week === 1 && row.team === "OFFENCE");
    // Week 1 has no results this season and none last season here, so it emits nothing rather than
    // reaching into the week it is about.
    expect(week1).toBeUndefined();
  });
});

describe("gameContextFor", () => {
  const metrics: TeamMetricLookup = (_team, _at, metric) =>
    ({
      [CONTEXT_METRICS.opponentPassDefence]: 1.08,
      [CONTEXT_METRICS.opponentRushDefence]: 0.94,
      [SCHEDULE_METRICS.restDays]: 4,
    })[metric] ?? null;

  it("reads the matchup and the rest for the week being predicted", () => {
    const context = gameContextFor("CLE", { season: 2024, week: 6 }, metrics);
    expect(context.opponentPassDefence).toBe(1.08);
    expect(context.opponentRushDefence).toBe(0.94);
    expect(context.restRatio).toBeCloseTo(4 / STANDARD_REST_DAYS, 10);
  });

  it("answers null where nothing is known, so a caller falls back rather than assuming average", () => {
    const context = gameContextFor("CLE", { season: 2024, week: 6 }, () => null);
    expect(context.opponentPassDefence).toBeNull();
    expect(context.restRatio).toBeNull();
  });
});
