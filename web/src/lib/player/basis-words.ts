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
	vsAvgCaption: 'our rest-of-season rate a game against his Avg'
} as const;

/** The steps the run stores from his Avg to our rate (Lane 139 fix round 1): his season blended with
 * his usage, the share his preseason pace carries, and the model's rate a game he plays, each null on a
 * run older than its field. */
export interface RateSteps {
	games: number;
	blended: number | null;
	share: number | null;
	rate: number | null;
}

/** The steps our rate a game takes from his Avg, in order and each with the run's figure (Lane 139 fix
 * round 1, HIGH-1): "in 5 games, blended with his usage 27.1, weighted 29% to his preseason pace 24.1,
 * games he may miss taken out". The last step is the figure the caption ends on, the API's rate a club
 * game. A run without the figures names the steps without them. */
export function vsAvgReason(steps: RateSteps): string {
	const { games, blended, share, rate } = steps;
	const played = `in ${plural(games, 'game')}`;
	const missed = 'games he may miss taken out';
	if (blended === null || share === null || rate === null)
		return `${played}, weighted with his preseason pace, ${missed}`;
	return `${played}, blended with his usage ${fixed(blended)}, weighted ${String(share)}% to his preseason pace ${fixed(rate)}, ${missed}`;
}

/** The tile's caption once its two figures are read, from his Avg through the stored steps to our rate:
 * "30.7 Avg in 5 games, ...: 22.0 a game"; without the steps "22.0 a game vs his 30.7 Avg". Its first
 * week is the Rest of season tile's, said there. */
export function vsAvgCaption(perGame: string, avg: string, reason: string | null): string {
	return reason === null
		? `${perGame} a game vs his ${avg} Avg`
		: `${avg} Avg ${reason}: ${perGame} a game`;
}
