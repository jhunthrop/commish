/** The in-season row under the player card's tiles in words (Lane 100, B17 and B51; Lane 139, C08 and
 * C09): the preseason pace a game his rest-of-season rate starts from, and that rate against his Avg,
 * whose tile says whose rate it is and what share of it the pace carries. The build words the row
 * (server/pages/player-card.ts) and the week's read fills its second tile (week-words.ts), so the words
 * stay out of the page's first script. */
import { plural } from '#lib/format/number.ts';

export const BASIS_WORDS = {
	pace: 'Preseason pace',
	paceCaption: 'a game, the pace our rate starts from',
	vsAvg: 'Our rate vs his Avg',
	vsAvgCaption: 'our rest-of-season rate a game against his Avg'
} as const;

/** Why our rate a game sits where it does against his Avg, from the order's stored basis: his games
 * weighted with the preseason pace (the tile beside it), the share the pace carries when the run says
 * it (absent on a run older than the field), and the games he may miss, which the rate a club game
 * counts in too ("less missed games"). */
export function vsAvgReason(games: number, share: number | null): string {
	const weighted = `${plural(games, 'game')} weighted with his preseason pace`;
	const counted = share === null ? weighted : `${weighted} at ${String(share)}%`;
	return `${counted}, less missed games`;
}

/** The tile's caption once its two figures are read, both named as the card prints them: "22.0 a game
 * vs his 30.7 Avg", then the stored reason. Its first week is the Rest of season tile's, said there. */
export function vsAvgCaption(perGame: string, avg: string, reason: string | null): string {
	const figures = `${perGame} a game vs his ${avg} Avg`;
	return reason === null ? figures : `${figures}: ${reason}`;
}
