import type { PlayerFactsFixture, PlayerFactsSchedule } from "./types";

/**
 * THE PUBLISHED SCHEDULE (spec §4, fact 11; inventory row 11).
 *
 * The sheet carried the bye week and nothing else about the season ahead. A manager plans around
 * the opener and around weeks fifteen to seventeen, and neither was on the page.
 *
 * NAMES AND COUNTS, NO STRENGTH JUDGMENT ANYWHERE. This engine has measured no opponent strength
 * for a season nobody has played, so the fixtures are stated as fixtures: who, which week, home or
 * away. Calling a schedule soft would be exactly the invented claim the whole sheet exists to keep
 * out of the writer's hands.
 *
 * `indoorGames` IS NULLABLE AND THE NULL IS LOAD-BEARING. Zero indoor games is a real fact about a
 * team that plays outdoors all year; "the schedule store holds no `indoors` row for this team" is a
 * different fact entirely, and reporting the second as the first would tell the writer something
 * nobody measured.
 */

/** The fantasy playoff weeks, stated here rather than written into a comparison so a league format
 *  that moves them is a one-line change with a name on it. */
export const FANTASY_PLAYOFF_WEEKS: readonly number[] = [15, 16, 17];

const OPENING_WEEK = 1;

/** One scheduled game, as `collect-depth.ts` reads it off `nfl_games`. */
export interface ScheduledGame {
  readonly week: number;
  readonly homeTeam: string;
  readonly awayTeam: string;
}

function fixtureFor(team: string, game: ScheduledGame): PlayerFactsFixture {
  const home = game.homeTeam === team;
  return { week: game.week, opponent: home ? game.awayTeam : game.homeTeam, home };
}

/** How many of his team's scheduled games the schedule store calls indoor, or `null` when it holds
 *  no `indoors` row for the team at all. */
function indoorCount(fixtures: readonly PlayerFactsFixture[], indoorsByWeek: ReadonlyMap<number, boolean>): number | null {
  const known = fixtures.filter((fixture) => indoorsByWeek.has(fixture.week));
  return known.length === 0 ? null : known.filter((fixture) => indoorsByWeek.get(fixture.week) === true).length;
}

/** His team's published schedule, or `null` when the store holds no game for it. */
export function scheduleFor(team: string, games: readonly ScheduledGame[], indoorsByWeek: ReadonlyMap<number, boolean>): PlayerFactsSchedule | null {
  const fixtures = games
    .filter((game) => game.homeTeam === team || game.awayTeam === team)
    .map((game) => fixtureFor(team, game))
    .sort((a, b) => a.week - b.week);
  if (fixtures.length === 0) return null;

  return {
    weekOneOpponent: fixtures.find((fixture) => fixture.week === OPENING_WEEK) ?? null,
    homeGames: fixtures.filter((fixture) => fixture.home).length,
    roadGames: fixtures.filter((fixture) => !fixture.home).length,
    indoorGames: indoorCount(fixtures, indoorsByWeek),
    playoffWeeks: fixtures.filter((fixture) => FANTASY_PLAYOFF_WEEKS.includes(fixture.week)),
  };
}
