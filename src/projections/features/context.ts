import { PBP_METRICS } from "../nflverse/pbp";
import { SCHEDULE_METRICS, type TeamGame } from "../nflverse/schedule";
import type { TeamWeekObservation } from "../team-store";
import type { TeamMetricLookup, WeekRef } from "../team-context";

/**
 * GAME CONTEXT — the opponent, the rest, and the two things that turned out not to be knowable.
 *
 * THE OPPONENT ADJUSTMENT IS THE WHOLE OF WHAT SHIPS FROM THIS FILE, and the reason is worth
 * stating before the code: a defence that has faced four bad offences is not an elite defence, and
 * every "points allowed" ranking in fantasy football makes exactly that mistake. The adjustment
 * divides each defence's allowed rate by the strength of the offences that produced it, which is
 * the same correction a strength-of-schedule table applies and which nothing free publishes weekly.
 *
 * WHAT COULD NOT BE MEASURED, and why it is stated here rather than quietly omitted:
 *
 *   - THE BETTING LINE. The implied team total and the spread are the best proxy for game script
 *     there is, and `games.csv` carries both — as CLOSING lines, which become knowable at kickoff.
 *     A week-W projection is replayed from the moment week W-1's numbers landed, so it cannot see
 *     them, and it must not: stamping a closing line as though it had been knowable on the Tuesday
 *     would make the feature measure well and make every number in the harness a lie. They are
 *     ingested and stamped honestly, and they sit in the store waiting for a pre-kickoff capture.
 *     `capture_snapshots` exists for precisely this and is already running.
 *   - THE WEATHER. `temp` and `wind` are RECORDED at the game, not forecast before it. A forecast
 *     is a different quantity from a measurement and we have no source for one, so weather is
 *     kickoff-stamped for the same reason and is equally invisible.
 *
 * REST IS KNOWABLE and is included: the schedule is published in May, so a Thursday game is a fact
 * about September that has been true since spring.
 */

export const CONTEXT_METRICS = {
  /**
   * How much MORE than average the defence a team faces this week has allowed per dropback, after
   * dividing out the offences it faced. Above 1 is a soft matchup.
   */
  opponentPassDefence: "opponent_pass_defence_adjusted",
  opponentRushDefence: "opponent_rush_defence_adjusted",
} as const;

export const CONTEXT_SOURCE = "commish_opponent_adjustment";

/** A normal week's rest. Everything is expressed relative to it. */
export const STANDARD_REST_DAYS = 7;

/** One defence's allowed rates for one week, and the offence that produced them. */
export interface DefenceWeek {
  readonly season: number;
  readonly week: number;
  readonly defence: string;
  readonly offence: string;
  readonly passYardsAllowedPerDropback: number | null;
  readonly rushYardsAllowedPerCarry: number | null;
  /** When this became knowable — the end of the game, on the same basis as every other stamp. */
  readonly asOf: Date;
}

/** A rating of 1 is exactly league average. Both directions are meaningful. */
export interface DefenceRating {
  readonly pass: number;
  readonly rush: number;
}

const LEAGUE_AVERAGE: DefenceRating = { pass: 1, rush: 1 };

/**
 * How many team-games of league prior a rating is shrunk toward.
 *
 * Six, and deliberately heavier than the line composite's four: a defence's allowed rate in one
 * game is one of the noisiest numbers in football, and four weeks of it against three bad offences
 * is the exact illusion this adjustment exists to remove.
 */
const RATING_SHRINKAGE_GAMES = 6;

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function shrunkRatio(values: readonly number[], league: number): number {
  if (values.length === 0 || league <= 0) return 1;
  const own = mean(values) / league;
  return (values.length * own + RATING_SHRINKAGE_GAMES) / (values.length + RATING_SHRINKAGE_GAMES);
}

/**
 * Every defence's rating, adjusted for the offences it faced, from the weeks given and no others.
 *
 * ONE ROUND OF ADJUSTMENT, not an iterated solve. The offences' own strengths are measured
 * unadjusted and then divided out of the defences' allowed rates; iterating to a fixed point would
 * be a more elegant estimate of a quantity whose input is a dozen noisy games, and the second
 * decimal place it would buy is well inside the noise it is estimating. Stated so nobody has to
 * wonder whether it was forgotten.
 */
export function defenceRatings(weeks: readonly DefenceWeek[]): ReadonlyMap<string, DefenceRating> {
  const passValues = weeks.map((week) => week.passYardsAllowedPerDropback).filter((value): value is number => value !== null);
  const rushValues = weeks.map((week) => week.rushYardsAllowedPerCarry).filter((value): value is number => value !== null);
  const leaguePass = mean(passValues);
  const leagueRush = mean(rushValues);
  if (leaguePass <= 0 || leagueRush <= 0) return new Map();

  // Each offence's own strength, unadjusted — how much more than average it gained, wherever it
  // gained it. This is what gets divided out of the defences' numbers below.
  const byOffence = new Map<string, DefenceWeek[]>();
  for (const week of weeks) (byOffence.get(week.offence) ?? byOffence.set(week.offence, []).get(week.offence)!).push(week);
  const offenceStrength = new Map<string, DefenceRating>(
    [...byOffence.entries()].map(([offence, games]) => [
      offence,
      {
        pass: shrunkRatio(games.map((game) => game.passYardsAllowedPerDropback).filter((v): v is number => v !== null), leaguePass),
        rush: shrunkRatio(games.map((game) => game.rushYardsAllowedPerCarry).filter((v): v is number => v !== null), leagueRush),
      },
    ]),
  );

  const byDefence = new Map<string, DefenceWeek[]>();
  for (const week of weeks) (byDefence.get(week.defence) ?? byDefence.set(week.defence, []).get(week.defence)!).push(week);
  return new Map(
    [...byDefence.entries()].map(([defence, games]) => {
      const adjusted = (field: "passYardsAllowedPerDropback" | "rushYardsAllowedPerCarry", key: "pass" | "rush") =>
        games
          .filter((game) => game[field] !== null)
          // The division is the adjustment: a defence that held a great offence below its own
          // average has done something, and one that held a bad offence to the same number has not.
          .map((game) => game[field]! / (offenceStrength.get(game.offence)?.[key] ?? 1));
      return [
        defence,
        {
          pass: shrunkRatio(adjusted("passYardsAllowedPerDropback", "pass"), leaguePass),
          rush: shrunkRatio(adjusted("rushYardsAllowedPerCarry", "rush"), leagueRush),
        },
      ];
    }),
  );
}

/**
 * The rating of the defence each team faces, week by week, as a team-week observation.
 *
 * Stamped with the last moment that informed it — the end of the newest game in the window — so a
 * week-W rating is knowable exactly when week W-1's results were, which is the moment week W is
 * replayed from. The OPPONENT'S IDENTITY is knowable in May and the RESULTS are not, so the later
 * of the two is the honest stamp.
 *
 * Week 1 carries the prior season's final ratings. A defence is not a new object in September, and
 * the alternative is no opponent adjustment at all for the one week nobody has evidence for.
 */
export function opponentDefenceObservations(
  games: readonly TeamGame[],
  defenceWeeks: readonly DefenceWeek[],
  seasons: readonly number[],
): readonly TeamWeekObservation[] {
  const rows: TeamWeekObservation[] = [];
  for (const season of seasons) {
    const thisSeason = defenceWeeks.filter((week) => week.season === season);
    const priorSeason = defenceWeeks.filter((week) => week.season === season - 1);
    const priorRatings = defenceRatings(priorSeason);
    const priorAsOf =
      priorSeason.length === 0 ? null : new Date(Math.max(...priorSeason.map((week) => week.asOf.getTime())));

    const weeksInSeason = [...new Set(games.filter((game) => game.season === season).map((game) => game.week))].sort(
      (a, b) => a - b,
    );
    for (const week of weeksInSeason) {
      const informing = thisSeason.filter((row) => row.week < week);
      const ratings = informing.length === 0 ? priorRatings : defenceRatings(informing);
      const asOf =
        informing.length === 0
          ? priorAsOf
          : new Date(Math.max(...informing.map((row) => row.asOf.getTime())));
      if (asOf === null) continue;

      for (const game of games.filter((row) => row.season === season && row.week === week)) {
        const rating = ratings.get(game.opponent) ?? LEAGUE_AVERAGE;
        const stamp = { season, week, team: game.team, source: CONTEXT_SOURCE, asOf } as const;
        rows.push({ ...stamp, metric: CONTEXT_METRICS.opponentPassDefence, value: rating.pass });
        rows.push({ ...stamp, metric: CONTEXT_METRICS.opponentRushDefence, value: rating.rush });
      }
    }
  }
  return rows;
}

/** What the game context says about one team's week. `null` where nothing is known. */
export interface GameContext {
  /** Above 1 is a soft pass matchup. */
  readonly opponentPassDefence: number | null;
  readonly opponentRushDefence: number | null;
  /** Days of rest over the standard seven. Below 1 is a short week. */
  readonly restRatio: number | null;
}

/**
 * One team's game context for the week being predicted.
 *
 * Reads the TARGET week rather than the weeks before it, unlike every other feature here, and that
 * is correct rather than a leak: these are facts ABOUT the coming game that were knowable before
 * it. The as-of gate is what enforces the distinction, and it is why the opponent rating and the
 * rest days pass while the closing line and the recorded temperature do not.
 */
export function gameContextFor(team: string, at: WeekRef, metrics: TeamMetricLookup): GameContext {
  const restDays = metrics(team, at, SCHEDULE_METRICS.restDays);
  return {
    opponentPassDefence: metrics(team, at, CONTEXT_METRICS.opponentPassDefence),
    opponentRushDefence: metrics(team, at, CONTEXT_METRICS.opponentRushDefence),
    restRatio: restDays === null || restDays <= 0 ? null : restDays / STANDARD_REST_DAYS,
  };
}

/** The metric names this feature reads from the play-by-play ingestion, spelled once. */
export const DEFENCE_METRICS = {
  pass: PBP_METRICS.passYardsAllowedPerDropback,
  rush: PBP_METRICS.rushYardsAllowedPerCarry,
} as const;
