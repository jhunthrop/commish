/** A league's settings in the room's words: "12 teams · PPR · slot 8". */
import { pickLabel } from '#lib/format/draft.ts';
import type { FactCell } from '#lib/ui/facts.ts';
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

/** The solo room's pick header as cells (Lane 66o): the round, the league, your slot, and while you
 * have one, your next pick and how many picks away it is. */
export function pickBarCells(
	s: LeagueSettings,
	slot: number,
	at: { now: number; round: number; next: number | null }
): FactCell[] {
	const lineup = lineupWords(s);
	return [
		{ label: 'Round', value: String(at.round) },
		{ label: 'Teams', value: String(s.teams) },
		{ label: 'Scoring', value: scoringWords(s), word: true },
		...(lineup ? [{ label: 'Lineup', value: lineup, word: true }] : []),
		{ label: 'Slot', value: String(slot) },
		...(at.next === null
			? []
			: [
					{ label: 'Your next', value: pickLabel(at.next, s.teams) },
					{ label: 'Picks away', value: String(Math.max(0, at.next - at.now - 1)) }
				])
	];
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
