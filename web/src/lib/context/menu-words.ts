/** What the switch's menu says of each league, apart from words.ts so a page carries it only once
 * the menu is opened. */
import { memberZone } from '#lib/format/clock.ts';
import { SCORING_WORDS, hostWords } from '#lib/league/names.ts';
import { phaseWord } from '#lib/league/phase-words.ts';
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

/** The menu's last row, the way to follow a league beside the account's. */
export const FOLLOW_ANOTHER = 'Follow another league';
/** The last row for an account with no league yet. */
export const FOLLOW_FIRST = 'Follow your league';

/** What closes a signed-in account's menu: the way to follow its first league, the way to follow
 * another for an account that may follow more, or, for one that may not (no many_leagues), what
 * more leagues come with (OneLeagueFree) and no row leading to a page that would refuse it. */
export type MenuLast = 'follow-first' | 'follow-another' | 'one-league-free';

export function menuLast(leagues: number, many: boolean): MenuLast {
	if (leagues === 0) return 'follow-first';
	return many ? 'follow-another' : 'one-league-free';
}

/** Each league's phase in a word beside its name, by league id, only when the account's leagues
 * are not all in one phase (spec 2026-10-16 §2): "Drafted", "Draft Sun 7:00 pm", "Playoffs".
 * Empty when they agree. */
export function phaseWords(
	leagues: readonly ContextLeague[],
	now: Date = new Date(),
	zone: string = memberZone()
): ReadonlyMap<string, string> {
	const phases = new Set(leagues.map((league) => league.phase));
	if (phases.size < 2) return new Map();
	return new Map(leagues.map((league) => [league.id, phaseWord(league, now, zone)]));
}
