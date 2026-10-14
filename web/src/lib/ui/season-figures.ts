import { fixed, plural } from '#lib/format/number.ts';
import { POINTS_PER_GAME_DECIMALS } from '#lib/run/decimals.ts';
import type { IndexSeason } from '#lib/run/schema.ts';

/** What a row prints before his first game this season. */
export const NO_GAMES_YET = 'no games yet';

/** His season so far as a board row prints it, the points a game first: "18.4 a game, 5 games", or
 * "no games yet". The board's basis line names the season and the week it reaches. */
export function seasonFigures(season: IndexSeason): string {
	if (season.pointsPerGame === null) return NO_GAMES_YET;
	const perGame = fixed(season.pointsPerGame, POINTS_PER_GAME_DECIMALS);
	return `${perGame} a game, ${plural(season.games, 'game')}`;
}
