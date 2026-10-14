/** What the switch's menu lists, apart from words.ts so a page carries these only once the menu is
 * opened: the formats with no league, and each league's line under its name. */
import { SCORING_WORDS, hostWords } from '#lib/league/names.ts';
import type { ContextFormat, ContextLeague } from './words.ts';

/** The formats the switch offers with no league, in the order it lists them. */
export const CONTEXT_FORMATS: readonly ContextFormat[] = ['ppr', 'half_ppr', 'standard'];

/** A league's line under its name in the switch: its host and its scoring, "FFPC, TE premium", and
 * the lineup when it reads on its own board, "Sleeper, half PPR, superflex". */
export function leagueLine(league: ContextLeague): string {
	const parts = [hostWords(league.host), SCORING_WORDS[league.scoring]];
	if (league.format === 'superflex') parts.push('superflex');
	return parts.join(', ');
}
