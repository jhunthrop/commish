/** What the switch's menu says of each league, apart from words.ts so a page carries it only once
 * the menu is opened. */
import { SCORING_WORDS, hostWords } from '#lib/league/names.ts';
import type { ContextLeague } from './words.ts';

/** TE premium in words a first-timer can read, as the league line says it. */
const TE_PREMIUM_WORDS = 'extra points per catch for tight ends';

/** A league's line under its name in the switch: its host and its scoring, "FFPC, extra points per
 * catch for tight ends", and the lineup when it reads on its own board, "Sleeper, half PPR,
 * superflex". */
export function leagueLine(league: ContextLeague): string {
	const scoring =
		league.scoring === 'te_premium' ? TE_PREMIUM_WORDS : SCORING_WORDS[league.scoring];
	const parts = [hostWords(league.host), scoring];
	if (league.format === 'superflex') parts.push('superflex');
	return parts.join(', ');
}
