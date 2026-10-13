/** A league's settings in the room's words: "12 teams · PPR · slot 8". */
import type { LeagueSettings } from './api.ts';

const SCORING: Record<string, string> = {
	ppr: 'PPR',
	half_ppr: 'half PPR',
	standard: 'standard',
	te_premium: 'TE premium'
};

/** A scoring preset in a sentence: "PPR", "half PPR". */
export function presetWords(preset: string): string {
	return SCORING[preset] ?? preset;
}

export function scoringWords(s: LeagueSettings): string {
	const preset = s.scoring.preset;
	return preset ? presetWords(preset) : 'your scoring';
}

export function lineupWords(s: LeagueSettings): string | null {
	if (s.lineup === 'superflex') return 'superflex';
	if (s.lineup === 'two_flex') return 'two flex';
	return null;
}

/** "12 teams · PPR · superflex · slot 8". */
export function leagueLine(s: LeagueSettings, slot: number): string {
	const lineup = lineupWords(s);
	return [`${s.teams} teams`, scoringWords(s), ...(lineup ? [lineup] : []), `slot ${slot}`].join(
		' · '
	);
}

/** An engine slot as the room labels it: DEF is DST, SUPERFLEX is SFLX. */
export function slotLabel(slot: string): string {
	if (slot === 'DEF') return 'DST';
	if (slot === 'SUPERFLEX') return 'SFLX';
	return slot;
}

/** "1st", "2nd", "3rd", "12th". */
export function ordinal(n: number): string {
	const tens = n % 100;
	if (tens >= 11 && tens <= 13) return `${n}th`;
	const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
	return `${n}${suffix}`;
}
