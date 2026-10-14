import { fixed, plural } from '#lib/format/number.ts';
import { POINTS_PER_GAME_DECIMALS } from '#lib/run/decimals.ts';
import type { IndexSeason } from '#lib/run/schema.ts';

/** What a row prints before his first game this season. */
export const NO_GAMES_YET = 'no games yet';

/** His season so far as a board row prints it, in two parts: the points a game ("18.4 a game"), or
 * "no games yet", and the games count after it (", 5 games"), null before his first game. A row
 * with the room prints both, "18.4 a game, 5 games". A narrow meta line prints the points a game
 * alone, and the basis line's "through week 5" and his page carry the count. */
export interface SeasonParts {
	perGame: string;
	games: string | null;
}

export function seasonParts(season: IndexSeason): SeasonParts {
	if (season.pointsPerGame === null) return { perGame: NO_GAMES_YET, games: null };
	const perGame = fixed(season.pointsPerGame, POINTS_PER_GAME_DECIMALS);
	return { perGame: `${perGame} a game`, games: `, ${plural(season.games, 'game')}` };
}
