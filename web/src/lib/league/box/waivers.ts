/** The Waivers screen as a pickup table (Lane 66f): the Lineup table turned outward. A strip names
 * the pickups worth making as cards (the add, the drop, this week's Proj gain and the rest of the
 * season's), each with the platform's verb; the table lists the players free to add in the Lineup's
 * columns, then the two only we give (A game, and Beats: the member's player he tops with the
 * gain); an add opens the players he could replace in the same columns, the advice's drop first.
 * Pure, tested in waivers.test.ts. */
import { lastName } from '#lib/format/draft.ts';
import { fixed, signed } from '#lib/format/number.ts';
import type { LeagueHost } from '../api.ts';
import type { StatusView } from '#lib/run/status-view.ts';
import type { PlayerLine, WaiverAdvice, WaiverRow } from '../inseason/api.ts';
import { addKey, claimsAdd } from '../inseason/move.ts';
import { LINES } from '../inseason/words.ts';
import { hostWords } from '../names.ts';
import {
	deltaPart,
	gamePart,
	kickedOffPartAt,
	phoneRoom,
	projPart,
	said,
	uncountedParts,
	type BasisPart,
	type Clock
} from './basis.ts';
import { BOX, boxNumber, boxRow, positionWord, type BoxRow } from './box.ts';
import { locked } from './lineup.ts';
import { SEASON, WAIVER_GAIN } from './season.ts';

/** Every word the Waivers strip, table and drop panel print, in one place for the copy guard. */
export const WAIVERS = {
	close: 'Close',
	beats: 'Beats',
	rest: SEASON.perGame,
	starter: 'Starter',
	bench: 'Bench',
	find: 'Find a player',
	noneFound: 'No player free to add by that name.',
	/** The card's rest-of-season gain and the drop panel's head over it. */
	gain: WAIVER_GAIN,
	thisWeek: 'Proj this week',
	copied: 'Copied',
	copyFailed: 'This browser would not copy his name.',
	noPickup: 'No pickup beats your roster',
	/** Beats for an add who fills a spot no one of the member's can play this week. */
	openSpot: 'Open spot',
	clears: 'Clears'
} as const;

/** A name's second mention: "Gainwell", a defense by its club ("Chiefs" from "Chiefs D/ST"). */
export function shortName(name: string): string {
	return lastName(name.replace(/\s+D\/ST$/, ''));
}

/** Whom an add beats, as the Beats cell prints it. */
export interface BeatsCell {
	name: string;
	starter: boolean;
	gain: number;
}

/** One player free to add, as the table draws him. */
export interface PoolRow {
	key: string;
	row: BoxRow;
	/** His rest-of-season points a game, null without one. */
	rest: number | null;
	beats: BeatsCell | null;
	/** The strip names him: his row is tinted, and only his (Lane 66f, persona M1). */
	named: boolean;
	/** "Clears Wed": the day a claim on him clears, where the platform says it; else null. */
	clears: string | null;
	source: WaiverRow;
}

/** One card of the strip. */
export interface PickupCard {
	key: string;
	slot: string;
	add: string;
	drop: string | null;
	/** This week's Proj gain, null once the add's or the drop's game has kicked off: the move is for
	 * next week then (Lane 85). */
	weekGain: number | null;
	gain: number;
	source: WaiverRow;
}

/** One player of the member's an add could replace, as the drop panel draws him. */
export interface DropRow {
	key: string;
	row: BoxRow;
	rest: number | null;
	gain: number;
	/** This week's Proj gain, null once his or the add's game has kicked off (Lane 85). */
	weekGain: number | null;
	/** The shared status chip when this week's lineup starts him (the API's mark, Lane 66u), else null. */
	starter: StatusView | null;
	line: PlayerLine;
}

/** The drop panel's mark on a player this week's lineup starts, in the shared status chip. */
export const STARTER_STATUS: StatusView = {
	rank: null,
	mark: WAIVERS.starter,
	sits: false,
	line: null
};

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });

/** "Clears Wed" from the platform's day (a calendar date, no clock): null without one. */
export function clearsWords(day: string | null): string | null {
	if (day === null) return null;
	const at = new Date(`${day}T12:00:00Z`);
	return Number.isNaN(at.getTime()) ? null : `${WAIVERS.clears} ${WEEKDAY.format(at)}`;
}

/** Whom an add beats, as the API says it: his player, or the open spot he fills (a starting spot no
 * one of the member's can play this week). Nothing is inferred here (review 66f M3). */
function beatsOf(source: WaiverRow): BeatsCell | null {
	const { beats } = source;
	if (beats === null) return null;
	return {
		name: beats.open_spot ? WAIVERS.openSpot : shortName(beats.name),
		starter: beats.starter,
		gain: beats.gain
	};
}

/** The table's rows from the answer: every add, whom he beats, the strip's tint on the ones it names. */
export function poolRows(
	advice: Pick<WaiverAdvice, 'rows' | 'pickups'>,
	zone: string,
	now: number
): PoolRow[] {
	const named = new Set(advice.pickups.map(addKey));
	return advice.rows.map((source) => {
		const key = addKey(source);
		return {
			key,
			row: { ...boxRow(source.add, '', zone, false, now), key },
			rest: source.add.rest_of_season_per_game,
			beats: beatsOf(source),
			named: named.has(key),
			clears: clearsWords(source.clears),
			source
		};
	});
}

/** A name as a card or the pair line says it: the last name, or the whole name when another player
 * on the screen shares that last name (review 66f L10: "drop Johnson" over a row for Theo Johnson). */
export function cardName(name: string, onScreen: readonly string[]): string {
	const short = shortName(name);
	const sharing = new Set(onScreen.filter((other) => shortName(other) === short));
	return sharing.size > 1 ? name : short;
}

/** Every player's name the screen shows: the adds and the member's roster. */
export function namesOnScreen(advice: Pick<WaiverAdvice, 'rows' | 'pickups' | 'roster'>): string[] {
	return [...advice.rows, ...advice.pickups]
		.map((r) => r.add.player.name)
		.concat(advice.roster.map((l) => l.player.name));
}

/** A week gain the screen may draw: the API's while both players' games are still to be played at
 * `now`, none once either has kicked off or is final (Lane 85). The add or the drop stays allowed;
 * it counts from next week. */
function weekGainOf(
	gain: number,
	add: PlayerLine,
	drop: PlayerLine | null,
	now: number
): number | null {
	return locked(add, now) || (drop !== null && locked(drop, now)) ? null : gain;
}

/** The strip's cards in the API's order: each one's week gain is his over the cards before him. */
export function pickupCards(
	advice: Pick<WaiverAdvice, 'rows' | 'pickups' | 'roster'>,
	now: number
): PickupCard[] {
	const names = namesOnScreen(advice);
	return advice.pickups.map((source) => ({
		key: addKey(source),
		slot: positionWord(source.add.player.position),
		add: cardName(source.add.player.name, names),
		drop: source.drop ? cardName(source.drop.player.name, names) : null,
		weekGain: weekGainOf(source.week_gain, source.add, source.drop, now),
		gain: source.gain,
		source
	}));
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three'];

/** "Two pickups", "One pickup", or the line for none. */
export function pickupsTitle(n: number): string {
	if (n === 0) return WAIVERS.noPickup;
	return `${NUMBER_WORDS[n] ?? String(n)} ${n === 1 ? 'pickup' : 'pickups'}`;
}

/** The strip's sentence for a screen reader: "Two pickups. Add Gainwell, drop Lemon. Add Chiefs,
 * drop Saints." */
export function stripDecision(cards: readonly Pick<PickupCard, 'add' | 'drop'>[]): string {
	return [pickupsTitle(cards.length), ...cards.map(moveWords)].join('. ') + '.';
}

/** "Add Gainwell, drop Lemon", or "Add Gainwell" into an open spot. */
export function moveWords(card: Pick<PickupCard, 'add' | 'drop'>): string {
	return card.drop === null
		? `${LINES.add} ${card.add}`
		: `${LINES.add} ${card.add}, drop ${card.drop}`;
}

/** A gain as its cell prints it: "+6.7", "−0.5", "0.0". */
export function gainWord(gain: number): string {
	const shown = Number(fixed(gain, 1));
	return shown === 0 ? fixed(0, 1) : signed(shown, 1);
}

/** "+6.7 Proj this week, +1.2 Gain a week", the Gain alone once the week figure is gone. */
export function cardGains(card: Pick<PickupCard, 'weekGain' | 'gain'>): string {
	const season = `${gainWord(card.gain)} ${WAIVERS.gain}`;
	return card.weekGain === null
		? season
		: `${gainWord(card.weekGain)} ${WAIVERS.thisWeek}, ${season}`;
}

/** The strip's sum, every figure the API's (review 66f H1): "96.4" (the lineup's Proj with every
 * card made) then "Proj with both, 87.0 without, +9.4"; null without both Proj or a card. */
export interface PickupSum {
	figure: string;
	words: string;
	gain: string;
}

export function pickupSum(
	advice: Pick<WaiverAdvice, 'lineup_proj' | 'pickups_proj'>,
	cards: readonly Pick<PickupCard, 'weekGain'>[]
): PickupSum | null {
	const { lineup_proj: without, pickups_proj: withAll } = advice;
	if (without === null || withAll === null || cards.length === 0) return null;
	// The sum is this week's: none once any card's week figure is gone (Lane 85).
	if (cards.some((c) => c.weekGain === null)) return null;
	const n = cards.length;
	const withWord = n === 1 ? 'him' : n === 2 ? 'both' : 'all three';
	return {
		figure: boxNumber(withAll),
		words: `${BOX.proj} with ${withWord}, ${boxNumber(without)} without`,
		gain: gainWord(withAll - without)
	};
}

/** The drop panel's rows for an add: every player he could replace, the advice's drop first, each
 * from the answer's roster. */
export function dropRows(
	source: WaiverRow,
	roster: readonly PlayerLine[],
	zone: string,
	now: number
): DropRow[] {
	const byId = new Map(roster.map((line) => [line.player.host_id, line]));
	return source.drops.flatMap((drop) => {
		const line = byId.get(drop.host_id);
		if (line === undefined) return [];
		return [
			{
				key: drop.host_id,
				row: boxRow(line, '', zone, false, now),
				rest: line.rest_of_season_per_game,
				gain: drop.gain,
				weekGain: weekGainOf(drop.week_gain, source.add, line, now),
				starter: drop.starts_this_week ? STARTER_STATUS : null,
				line
			}
		];
	});
}

/** The week's gain said once over the drops when every drop gives the same: "+6.7"; else null and
 * each row says its own. */
export function sameWeekGain(drops: readonly Pick<DropRow, 'weekGain'>[]): number | null {
	// A drop with no week figure: none said over them, each row says its own (or none).
	const first = drops[0];
	if (first === undefined) return null;
	return drops.every((d) => d.weekGain === first.weekGain) ? first.weekGain : null;
}

/** "Drop one for Kenny Gainwell". */
export function dropTitle(name: string): string {
	return `Drop one for ${name}`;
}

/** "+6.7 Proj this week with any of them. The one you lose least by comes first." */
export function dropLead(weekGain: number | null): string {
	const first = 'The one you lose least by comes first.';
	return weekGain === null
		? first
		: `${gainWord(weekGain)} ${WAIVERS.thisWeek} with any of them. ${first}`;
}

/** The row an add's claim names with the drop the member chose. */
export function withDrop(source: WaiverRow, drop: DropRow | null): WaiverRow {
	if (drop === null) return source;
	return {
		...source,
		drop: drop.line,
		gain: drop.gain,
		week_gain: drop.weekGain ?? source.week_gain
	};
}

/** The table's sortable columns. */
export type SortKey =
	'name' | 'game' | 'proj' | 'opp' | 'avg' | 'last' | 'delta' | 'rest' | 'beats';

export interface Sort {
	key: SortKey;
	/** Highest first, the default for a number. */
	down: boolean;
}

/** The table's default: Beats, a starter he tops first, then by the gain. */
export const DEFAULT_SORT: Sort = { key: 'beats', down: true };

/** What a starter topped adds to the Beats sort, above any bench gain. */
const STARTER_RANK = 1000;

/** A row's value for a column, null when not held (always last, whichever way). */
function valueOf(r: PoolRow, key: SortKey): number | string | null {
	const { row } = r;
	switch (key) {
		case 'name':
			return row.name;
		case 'game':
			return r.source.add.facts.kickoff;
		case 'proj':
			return row.proj;
		case 'opp':
			return row.evidence.oppRank;
		case 'avg':
			return row.evidence.avg;
		case 'last':
			return row.evidence.last;
		case 'delta':
			return row.evidence.delta;
		case 'rest':
			return r.rest;
		case 'beats':
			// A starter topped (or an open spot filled) outranks any bench gain.
			if (r.beats === null) return null;
			return (r.beats.starter ? STARTER_RANK : 0) + r.beats.gain;
	}
}

/** The rows sorted by a column, the not-held last, ties kept in the answer's order. */
export function sortRows(rows: readonly PoolRow[], sort: Sort): PoolRow[] {
	const dir = sort.down ? -1 : 1;
	return rows
		.map((r, i) => ({ r, i, v: valueOf(r, sort.key) }))
		.sort((a, b) => {
			if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
			if (a.v === b.v) return a.i - b.i;
			return (a.v < b.v ? -1 : 1) * dir;
		})
		.map(({ r }) => r);
}

/** A column chosen again turns it around; a new column starts highest first, a name A to Z, a game
 * soonest first. */
export function nextSort(current: Sort, key: SortKey): Sort {
	if (current.key === key) return { key, down: !current.down };
	return { key, down: key !== 'name' && key !== 'game' };
}

/** The rows whose name holds the search, any case; every row for an empty one. */
export function findRows(rows: readonly PoolRow[], query: string): PoolRow[] {
	const q = query.trim().toLowerCase();
	return q === '' ? [...rows] : rows.filter((r) => r.row.name.toLowerCase().includes(q));
}

/** "Open ESPN waivers": the verb where a claim is not made from here. */
export function openWaiversWords(host: LeagueHost): string {
	return `Open ${hostWords(host)} waivers`;
}

/** An add's verb by the Waivers rule (claimsAdd), for the Waivers screen and the order alike. */
export function addVerbWords(
	moves: Pick<WaiverAdvice['moves'], 'claim'> | null,
	hostId: string,
	host: LeagueHost
): string {
	return claimsAdd(moves, hostId) ? addOnWords(host) : openWaiversWords(host);
}

/** "Add on ESPN": the verb where the claim is made from here. */
export function addOnWords(host: LeagueHost): string {
	return `${LINES.add} on ${hostWords(host)}`;
}

/** The line once the platform verb is pressed: "Copied Gainwell. Add him on ESPN's waiver page." (the
 * casual persona's point), the page its link where the API knows it. */
export interface CopiedLine {
	said: string;
	page: string;
}

export function copiedWords(host: LeagueHost, name: string, copied: boolean): CopiedLine {
	return {
		said: copied ? `${WAIVERS.copied} ${name}. Add him on` : `${WAIVERS.copyFailed} Add him on`,
		page: `${hostWords(host)}'s waiver page`
	};
}

/** What the table holds (review 66f M4): "60 free agents we rank on Sleeper, 5 beat a player of
 * yours", the open spots not counted as players. */
export function countWords(
	rows: readonly Pick<PoolRow, 'beats' | 'source'>[],
	host: LeagueHost
): string {
	const n = rows.length;
	const beating = rows.filter((r) => r.source.beats !== null && !r.source.beats.open_spot).length;
	return `${String(n)} free ${n === 1 ? 'agent' : 'agents'} we rank on ${hostWords(host)}, ${String(beating)} ${beating === 1 ? 'beats' : 'beat'} a player of yours`;
}

/** The Waivers basis, one paragraph (Lane 66t): the pickup rule, Gain and the figure a game (the API's
 * words), Proj, its change at a desk, the Game cell's read, Opp rank, and the rules Avg and Last leave
 * out with the link to them. Beats and Open spot say themselves in their cells. */
export function waiverBasis(
	advice: Pick<
		WaiverAdvice,
		| 'basis'
		| 'season_basis'
		| 'basis_note'
		| 'basis_note_link'
		| 'projection_read_at'
		| 'projection_previous_read_at'
		| 'projection_scoring'
	>,
	lines: readonly PlayerLine[],
	rulesHref: string,
	clock: Clock,
	now: number
): BasisPart[] {
	const defense = lines.some((l) => l.player.position === 'DEF');
	const read = gamePart(lines, clock, now, 'read');
	const room = phoneRoom({ full: read, read }, kickedOffPartAt(lines, now));
	const proj = projPart(
		{
			readAt: advice.projection_read_at,
			scoring: advice.projection_scoring,
			defense,
			league: true
		},
		clock
	);
	return [
		...said(advice.basis),
		...said(advice.season_basis),
		...said(proj),
		...said(deltaPart(advice.projection_previous_read_at, clock), false),
		...room.game,
		...room.waiting,
		...room.opp,
		...uncountedParts(advice, rulesHref)
	];
}
