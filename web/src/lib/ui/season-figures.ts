import { fixed, plural } from '#lib/format/number.ts';
import { POINTS_PER_GAME_DECIMALS } from '#lib/run/decimals.ts';
import type { IndexSeason } from '#lib/run/schema.ts';

/** What a row prints before his first game this season. */
const NO_GAMES_YET = 'no games yet';

/** His season so far as a board row prints it, in two parts: the points a game ("18.4 a game", or
 * "no games yet") and the games count after it (", 5 games", null before his first game). On a desk
 * the count has a Games column of its own and the meta line prints the first part alone; under 1181
 * px and on the phone the line prints both, "18.4 a game, 5 games". */
export interface SeasonParts {
	perGame: string;
	/** ", 5 games", or "" before his first game. */
	games: string;
}

export function seasonFigures(season: IndexSeason): SeasonParts {
	if (season.pointsPerGame === null) return { perGame: NO_GAMES_YET, games: '' };
	const perGame = fixed(season.pointsPerGame, POINTS_PER_GAME_DECIMALS);
	return { perGame: `${perGame} a game`, games: `, ${plural(season.games, 'game')}` };
}
