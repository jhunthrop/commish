/** A league's settings in the room's words: "12 teams · PPR · slot 8". */
import { pickLabel } from '#lib/format/draft.ts';
import { poolCount } from '#lib/format/pool-words.ts';
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

/** The rooms' words (Lane 210): the call's and the pool's heads, the pool's own, and the team's, in a
 * table the apps print from (shared/scripts/gen-words.ts); the lines that carry a figure are built by
 * the functions below. */
export const ROOM = {
	player: 'Player',
	overRepl: 'Over repl',
	overReplacement: 'Over replacement',
	adp: 'ADP',
	gap: 'Gap',
	waitingOnCall: 'Waiting on the call',
	pool: 'Pool',
	yourTeam: 'Your team',
	/** An open roster slot. */
	open: 'open',
	/** The wall's title (Wall.svelte), and its cell on the clock: yours, a shared draft's seat, anyone's. */
	wall: 'The wall',
	yourPick: 'Your pick',
	theirPick: 'Their pick',
	onTheClock: 'On the clock'
} as const;

/** The wall's label: "rounds 1 to 3 of 20". */
export function wallRounds(shown: number, rounds: number): string {
	return `rounds 1 to ${String(shown)} of ${String(rounds)}`;
}

/** The pool's count line: "1,447 left to draft, ranked by points over replacement". */
export function poolLine(left: number): string {
	return `${poolCount(left, 'room')}, ranked by points over replacement`;
}

/** Under a pool row with no chance to show, in words that fit the column: no call coming (`gone`),
 * not in this card's chances (`read`, the card carries some), or on their way with the call. */
export function chanceMissing(gone: boolean, read: boolean): string {
	if (gone) return 'no call';
	return read ? 'not read' : 'with our call';
}

/** The pool's line when no row is left under the chip or the search. */
export function poolEmpty(search: string, filter: string): string {
	const needle = search.trim();
	const at = filter === 'All' || filter === 'Queue' ? '' : ` at ${filter}`;
	if (needle !== '') return `Nobody named ${needle}${at} in the pool.`;
	if (filter === 'Queue') return 'Nobody in your queue. Mark a player and press Q to add him.';
	return `Nobody left${at}.`;
}

/** The pool's verb for its next rows: "Show 25 more". */
export function showMore(rows: number): string {
	return `Show ${String(rows)} more`;
}

/** The team panel's count: "3 of 20". */
export function teamCount(drafted: number, rosterSize: number): string {
	return `${String(drafted)} of ${String(rosterSize)}`;
}

/** The strip of picks since your last turn, its first line: "went since your pick at 2.08", or before
 * your first pick "went before your first pick". */
export function sinceLead(since: number | null, teams: number, whose: 'your' | 'their'): string {
	return since === null
		? `went before ${whose} first pick`
		: `went since ${whose} pick at ${pickLabel(since, teams)}`;
}

/** The strip's second line, how many of them were queued: "none from your queue", "2 from your
 * queue". */
export function sinceQueued(fromQueue: number, whose: 'your' | 'their'): string {
	return `${fromQueue === 0 ? 'none' : String(fromQueue)} from ${whose} queue`;
}

/** The line where the strip would sit when no pick landed between two turns. */
export function straightBack(whose: 'your' | 'their'): string {
	return `${whose === 'your' ? 'Your' : 'Their'} turn came straight back`;
}
