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

/** "12 teams · PPR · superflex". */
export function formatLine(s: LeagueSettings): string {
	const lineup = lineupWords(s);
	return [`${s.teams} teams`, scoringWords(s), ...(lineup ? [lineup] : [])].join(' · ');
}

/** "12 teams · PPR · superflex · slot 8". */
export function leagueLine(s: LeagueSettings, slot: number): string {
	return `${formatLine(s)} · slot ${slot}`;
}

/** An engine slot as the room labels it: DEF is DST, SUPERFLEX is SFLX. */
export function slotLabel(slot: string): string {
	if (slot === 'DEF') return 'DST';
	if (slot === 'SUPERFLEX') return 'SFLX';
	return slot;
}

/** A bot's name in every room: numbered by its seat, the way the wall and the field list it. */
export function botName(seat: number): string {
	return `Bot ${seat}`;
}

/** A solo room's seats: you, and the bots by seat. */
export function botNames(teams: number, slot: number): string[] {
	return Array.from({ length: teams }, (_, i) => (i + 1 === slot ? 'You' : botName(i + 1)));
}

/** How far your next pick is, after the one on the clock: "right after this one", "1 pick away". */
export function picksAwayWords(between: number): string {
	if (between <= 0) return 'right after this one';
	return between === 1 ? '1 pick away' : `${between} picks away`;
}
