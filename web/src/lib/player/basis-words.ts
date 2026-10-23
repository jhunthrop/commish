/** The in-season row under the player card's tiles in words (Lane 100, B17 and B51; Lane 139, C08 and
 * C09): the preseason pace a game his rest-of-season rate starts from, and that rate against his Avg,
 * whose tile says whose rate it is and the steps from his Avg to it. The build words the row
 * (server/pages/player-card.ts) and the week's read fills its second tile (week-words.ts), so the words
 * stay out of the page's first script. */
import { fixed, plural } from '#lib/format/number.ts';

export const BASIS_WORDS = {
	pace: 'Preseason pace',
	paceCaption: 'a game, the pace our rate starts from',
	vsAvg: 'Our rate vs his Avg',
	vsAvgCaption: 'our rest-of-season rate a game against his Avg',
	/** The caption's last step, said only with games he may miss (D17). */
	afterMissed: 'a game after the games he may miss'
} as const;

/** Tenths in a game, so the missed games are taken from the printed figures. */
const TENTHS_IN_GAME = 10;

/** The games he may miss the caption names from (Lane 165 fix round 1, D17): the model's expected games
 * sit under his club's games left for every player (an availability prior), so only a whole game or
 * more is a story worth a clause. */
export const MISSED_GAMES_FROM = 1;

/** The games the run expects him to miss of his club's left: games left less the run's expectedGames,
 * both from the run's own figures for him (his log is the run's schedule), in whole tenths. Null with
 * no games left to count. */
export function missedGames(expectedGames: number, gamesLeft: number | null): number | null {
	if (gamesLeft === null) return null;
	return (gamesLeft * TENTHS_IN_GAME - Math.round(expectedGames * TENTHS_IN_GAME)) / TENTHS_IN_GAME;
}

/** Whether the caption says games he may miss: at least MISSED_GAMES_FROM of them. */
export function mayMissGames(expectedGames: number, gamesLeft: number | null): boolean {
	const missed = missedGames(expectedGames, gamesLeft);
	return missed !== null && missed >= MISSED_GAMES_FROM;
}

/** The steps the run stores from his Avg to our rate (Lane 139 fix round 1): his season blended with
 * his usage, the share his preseason pace carries, and the model's rate a game he plays, each null on a
 * run older than its field. */
export interface RateSteps {
	games: number;
	blended: number | null;
	share: number | null;
	rate: number | null;
}

/** The steps our rate a game takes from his Avg, in order, each result before the step that made it so
 * no figure reads as the thing it was blended with (Lane 139 fix round 2): "in 5 games, 27.1 blended with
 * his usage, 24.1 weighted 29% to his preseason pace". The caption ends on the last step, the API's rate a
 * club game after the games he may miss, said only when the run holds some (mayMissGames, D17). A run without the figures names the step alone. */
export function vsAvgReason(steps: RateSteps): string {
	const { games, blended, share, rate } = steps;
	const played = `in ${plural(games, 'game')}`;
	if (blended === null || share === null || rate === null)
		return `${played}, weighted with his preseason pace`;
	return `${played}, ${fixed(blended)} blended with his usage, ${fixed(rate)} weighted ${String(share)}% to his preseason pace`;
}

/** The tile's caption once its two figures are read, from his Avg through the stored steps to our rate:
 * "30.7 Avg in 5 games, ..., 22.0 a game after the games he may miss"; without the steps "22.0 a game vs
 * his 30.7 Avg". Its first week is the Rest of season tile's, said there. */
export function vsAvgCaption(
	perGame: string,
	avg: string,
	reason: string | null,
	mayMiss: boolean
): string {
	if (reason === null) return `${perGame} a game vs his ${avg} Avg`;
	return mayMiss
		? `${avg} Avg ${reason}, ${perGame} ${BASIS_WORDS.afterMissed}`
		: `${avg} Avg ${reason}`;
}
