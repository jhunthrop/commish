/** What the switch's menu says of each league, apart from words.ts so a page carries it only once
 * the menu is opened. */
import { SCORING_WORDS, hostWords } from '#lib/league/names.ts';
import type { ContextLeague } from './words.ts';

/** A league's line under its name in the switch: its host and its scoring, "FFPC, TE premium", and
 * the lineup when it reads on its own board, "Sleeper, half PPR, superflex". */
export function leagueLine(league: ContextLeague): string {
	const parts = [hostWords(league.host), SCORING_WORDS[league.scoring]];
	if (league.format === 'superflex') parts.push('superflex');
	return parts.join(', ');
}
