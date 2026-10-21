/** The Waivers screen as a pickup table (Lane 66f): the Lineup table turned outward. A strip names
 * the pickups worth making as cards (the add, the drop, this week's Proj gain and the rest of the
 * season's), each with the platform's verb; the table lists the players free to add in the Lineup's
 * columns, then the two only we give (A game, and Beats: the player his move replaces with the
 * season Gain), the rows that gain first and the rest under one divider (Lane 98); an add opens the
 * players he could replace in the same columns, the advice's drop first. Pure, tested in
 * waivers.test.ts. */
import { lastName } from '#lib/format/draft.ts';
import { fixed, signed } from '#lib/format/number.ts';
import type { LeagueHost } from '../api.ts';
import type { StatusView } from '#lib/run/status-view.ts';
import type { PlayerLine, WaiverAdvice, WaiverRow } from '../inseason/api.ts';
import { addKey, claimsAdd } from '../inseason/move.ts';
import { LINES } from '../inseason/words.ts';
import { hostWords } from '../names.ts';
import {
	anyKicked,
	deskOrPhone,
	waiverFinalsParts,
	gamePart,
	OPP_PART,
	OPP_PHONE,
	projPart,
	projPhonePart,
	said,
	stamp,
	uncountedPart,
	type BasisPart,
	type Clock,
	type ProjFacts
} from './basis.ts';
import {
	BOX,
	boxNumber,
	boxRow,
	initialName,
	onReserve,
	positionWord,
	type BoxRow
} from './box.ts';
import { addressedWeek, arrivesPart } from './next-week.ts';
import { GAIN_A_WEEK, SEASON } from './season.ts';

/** Every word the Waivers strip, table and drop panel print, in one place for the copy guard. */
export const WAIVERS = {
	close: 'Close',
	beats: 'Beats',
	rest: SEASON.perGame,
	starter: 'Starter',
	bench: 'Bench',
	/** After Starter for a rest-of-season starter on his bye in the week addressed (Lane 108, B81). */
	onBye: 'bye',
	find: 'Find a player',
	noneFound: 'No player free to add by that name.',
	/** The card's rest-of-season gain and the drop panel's head over it. */
	gain: GAIN_A_WEEK,
	thisWeek: 'Proj this week',
	copied: 'Copied',
	copyFailed: 'This browser would not copy his name.',
	noPickup: 'No pickup beats your roster',
	/** Beats for an add who fills a spot no one of the member's can play this week. */
	openSpot: 'Open spot',
	/** Why a card's drop is the one it names (review L-C). */
	dropRule: 'Its drop costs least.',
	clears: 'Clears',
	/** The divider over the rows that add nothing to the lineup (Lane 98, B13). */
	noGain: 'No gain over your roster',
	/** Why a card's drop is the one it names, where he is on injured reserve on the bench (B34). */
	irBench: 'IR, on your bench'
} as const;

/** Every word the Stash group prints (Lane 118, B79): its divider, its line, a row's Game cell, Beats
 * cell and verb. */
export const STASH = {
	head: 'Stash',
	verb: 'Stash',
	/** A stash's Game cell: the week he is due back (backWords). */
	back: (week: number): string => `Back week ${String(week)}`,
	backNow: 'Back this week',
	/** The Beats cell of a stash an open IR slot takes with a bench spot open: the slot, its state. */
	slot: 'IR slot',
	open: 'Open',
	/** Under the drop's name, as the gaining rows name theirs. */
	drop: 'Drop',
	/** The group's line (fix round 1): where the week comes from, and that A game is the rate his player
	 * page shows. */
	line: 'Stash rows come back by the listed return date. A game is his rate when he plays.',
	/** Said once where the page leaves an IR or out free agent unlisted for want of a date. */
	undated: 'IR and out players without a return date are not listed.',
	/** Said once where the page leaves one unlisted whose return is after the regular season. */
	late: 'IR and out players back after the regular season are not listed.'
} as const;

/** The columns' basis, once under their heads (Lane 98, B35): each head with what it is. */
export const HEAD_BASIS = {
	rest: 'is our rest-of-season points a game',
	avg: 'his season average',
	/** "his Proj's change since Sunday 2 pm". */
	delta: (since: string): string => `his ${BOX.proj}'s change since ${since}`,
	beats: 'the player he would replace in your rest-of-season lineup'
} as const;

/** A name's second mention: "Gainwell", a defense by its club ("Chiefs" from "Chiefs D/ST"). */
export function shortName(name: string): string {
	return lastName(name.replace(/\s+D\/ST$/, ''));
}

/** Whom an add beats, as the Beats cell prints it (Lane 98, B14). */
export interface BeatsCell {
	/** The player his move replaces (the API's: the offered move's drop, else the weakest starter he
	 * would displace), or the open spot he fills; null where he beats nobody, and on a row that gains
	 * nothing ("if he beats nobody, say nothing"). Starter is his place in the rest-of-season lineup,
	 * bye his bye in the week addressed (Lane 108, B81). */
	who: { name: string; starter: boolean; bye: boolean } | null;
	/** The season Gain, the column's key on every row in either order (review M-A); null on a row the
	 * rule cannot judge (a Gain with no one named), which draws no Gain (fix round 1, H1). */
	gain: number | null;
	/** The row adds to the lineup: its Gain is drawn loud, the rest quiet (B13). */
	gains: boolean;
	/** The strip's move on its own row: the card's week Proj gain under the season Gain ("+4.8 Proj"),
	 * so the row says why it is offered (review M1); null on any other row and in the season order. */
	week: number | null;
}

/** One player free to add, as the table draws him. */
export interface PoolRow {
	key: string;
	row: BoxRow;
	/** His rest-of-season points a game, null without one. */
	rest: number | null;
	beats: BeatsCell;
	/** The strip names him: his row is tinted, and only his (Lane 66f, persona M1). */
	named: boolean;
	/** "Clears Wed": the day a claim on him clears, where the platform says it; else null. */
	clears: string | null;
	/** The Beats sort's figure: the row's season Gain, so the default sort keeps the API's order among
	 * the rows that gain (review M-H). */
	order: number;
	/** The row is offered as a pickup: a Gain above zero, or a card of the strip (B13). */
	gains: boolean;
	/** A row of the Stash group (Lane 118, B79), null on a row of the table's other groups. */
	stash: StashCell | null;
	source: WaiverRow;
}

/** A stash as its row draws it (B79): his Game cell, his verb, and whom the Beats cell names. */
export interface StashCell {
	/** "Back week 9", "Back this week". */
	back: string;
	/** Stash where an open IR slot takes him, else Add. */
	verb: 'stash' | 'add';
	/** The Beats cell: his drop by name (the gaining rows' drop rule), else the open IR slot; null with
	 * neither. */
	who: { name: string; place: string } | null;
	/** He names a drop: either verb opens the drop panel; a Stash with none opens the platform's page. */
	drops: boolean;
}

/** One card of the strip. */
export interface PickupCard {
	key: string;
	slot: string;
	add: string;
	drop: string | null;
	/** Why the drop is the one named where it says itself: "IR, on your bench" (B34); else null. */
	dropWhy: string | null;
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

/** Whether a gain is one the page prints above zero. */
function positive(gain: number): boolean {
	return Number(fixed(gain, 1)) > 0;
}

/** A name in the Beats cell: the last name, or the first initial and the last name when another
 * player on the screen shares it ("R. Johnson" beside a row for Theo Johnson, review M2). */
export function beatsName(name: string, onScreen: readonly string[]): string {
	return cardName(name, onScreen) === name
		? initialName(name.replace(/\s+D\/ST$/, ''))
		: shortName(name);
}

/** Whom an add beats, as the API names him (the offered move's drop, else the player his move takes
 * out of the rest-of-season lineup, or the open slot he fills), with the row's season Gain in either
 * order: one key for the column, never "Bye" in place of a name (B14). A row that gains nothing names
 * no one; a Gain with no one named is no Gain the page can stand behind, so it draws none (fix round
 * 1, H1). Nothing is inferred or re-ordered here (review 66f M3). */
function beatsOf(
	source: WaiverRow,
	gains: boolean,
	card: WaiverRow | undefined,
	names: readonly string[]
): BeatsCell {
	const { beats } = source;
	const who =
		beats === null || !gains
			? null
			: {
					name: beats.open_spot ? WAIVERS.openSpot : beatsName(beats.name, names),
					starter: beats.starter,
					// An answer before Lane 108 sends no bye: read as off it.
					bye: beats.bye === true
				};
	const judged = beats !== null || !positive(source.gain);
	return {
		who,
		gain: judged ? source.gain : null,
		gains,
		week: card?.week_gain ?? null
	};
}

/** The Beats cell's figure: "+0.3 Gain" on a row that gains, the bare "0.0" on one that does not, so a
 * zero is never the loud cell (B13); "--" on a row the rule cannot judge. */
export function beatsWord(beats: Pick<BeatsCell, 'gain' | 'gains'>): string {
	if (beats.gain === null) return BOX.none;
	return beats.gains ? `${gainWord(beats.gain)} ${SEASON.gain}` : gainWord(beats.gain);
}

/** The named player's place under his name (Lane 108, B81): his place in the rest-of-season lineup,
 * "Starter" or "Bench", and "Starter, bye" for a starter on his bye in the week addressed. */
export function beatsPlace(who: NonNullable<BeatsCell['who']>): string {
	if (!who.starter) return WAIVERS.bench;
	return who.bye ? `${WAIVERS.starter}, ${WAIVERS.onBye}` : WAIVERS.starter;
}

/** The card's week figure under its row's Gain: "+4.8 Proj" (review M1). */
export function beatsWeekWord(week: number): string {
	return `${gainWord(week)} ${BOX.proj}`;
}

/** The table's rows from the answer: every add, whom he beats, the strip's tint on the ones it names.
 * A row counts as beating a player of yours only when Beats names one (fix round 1, H1), or when it is
 * the strip's own move. */
export function poolRows(
	advice: Pick<WaiverAdvice, 'rows' | 'pickups' | 'roster'>,
	zone: string,
	now: number
): PoolRow[] {
	const cards = new Map(advice.pickups.map((p) => [addKey(p), p]));
	const names = namesOnScreen(advice);
	return advice.rows.map((source) => {
		const key = addKey(source);
		const card = cards.get(key);
		const gains = card !== undefined || (positive(source.gain) && source.beats !== null);
		return {
			key,
			row: { ...boxRow(source.add, '', zone, false, now), key },
			rest: source.add.rest_of_season_per_game,
			beats: beatsOf(source, gains, card, names),
			named: card !== undefined,
			clears: clearsWords(source.clears),
			order: source.gain,
			gains,
			stash: null,
			source
		};
	});
}

/** The Stash group's rows (B79) in the API's order, by his rate from his return week: his Game cell
 * says the week, A game is that rate, Beats names the open IR slot or the drop. Never counted with the
 * rows that gain. */
export function stashRows(
	advice: Pick<WaiverAdvice, 'rows' | 'pickups' | 'roster' | 'week'> &
		Partial<Pick<WaiverAdvice, 'stash' | 'for_week'>>,
	zone: string,
	now: number
): PoolRow[] {
	const names = namesOnScreen(advice);
	const addressed = addressedWeek({ week: advice.week, for_week: advice.for_week });
	return (advice.stash ?? []).flatMap((source) => {
		const { stash } = source;
		if (stash === undefined) return [];
		const key = addKey(source);
		const verb = stash.ir_slot ? 'stash' : 'add';
		return [
			{
				key,
				row: { ...boxRow(source.add, '', zone, false, now), key },
				rest: stash.per_game,
				beats: { who: null, gain: null, gains: false, week: null },
				named: false,
				clears: clearsWords(source.clears),
				order: stash.per_game ?? Number.NEGATIVE_INFINITY,
				gains: false,
				stash: {
					back: backWords(stash.back_week, addressed),
					verb,
					who: stashWho(source, verb, names),
					drops: source.drop !== null
				},
				source
			}
		];
	});
}

/** A stash's Game cell: "Back this week" in the week the page addresses, else "Back week 9". */
export function backWords(week: number, addressed: number): string {
	return week === addressed ? STASH.backNow : STASH.back(week);
}

/** Whom a stash's Beats cell names (B79): his drop as the gaining rows name a player (the IR slot frees
 * no bench spot until the platform moves him, fix round 1 ruling), else the open IR slot, else nobody. */
function stashWho(
	source: WaiverRow,
	verb: StashCell['verb'],
	names: readonly string[]
): StashCell['who'] {
	if (source.drop !== null)
		return { name: beatsName(source.drop.player.name, names), place: STASH.drop };
	return verb === 'stash' ? { name: STASH.slot, place: STASH.open } : null;
}

/** The Stash group's line (B79), said once under its divider: where its rows' weeks come from and what
 * A game is, then the IR and out free agents left out for want of a date or for a return after the
 * regular season; empty with none of them, so no group is drawn. */
export function stashBasis(
	advice: Partial<Pick<WaiverAdvice, 'stash' | 'stash_undated' | 'stash_late'>>
): string[] {
	return [
		...((advice.stash ?? []).length > 0 ? [STASH.line] : []),
		...((advice.stash_undated ?? 0) > 0 ? [STASH.undated] : []),
		...((advice.stash_late ?? 0) > 0 ? [STASH.late] : [])
	];
}

/** The table's two groups (B13): the rows offered as pickups, then those with no gain over the roster
 * under one divider, each in the order given. */
export function gainGroups(rows: readonly PoolRow[]): { gaining: PoolRow[]; rest: PoolRow[] } {
	return { gaining: rows.filter((r) => r.gains), rest: rows.filter((r) => !r.gains) };
}

/** "IR, on your bench" for a card whose drop is on injured reserve and on the bench this week (B34);
 * else null. */
export function dropWhy(source: Pick<WaiverRow, 'drop' | 'drops'>): string | null {
	const { drop } = source;
	if (drop === null || !onReserve(drop)) return null;
	const starts = source.drops.some((d) => d.host_id === drop.player.host_id && d.starts_this_week);
	return starts ? null : WAIVERS.irBench;
}

/** A name as a card or the pair line says it: the last name, or the whole name when another player
 * on the screen shares that last name (review 66f L10: "drop Johnson" over a row for Theo Johnson). */
export function cardName(name: string, onScreen: readonly string[]): string {
	const short = shortName(name);
	const sharing = new Set(onScreen.filter((other) => shortName(other) === short));
	return sharing.size > 1 ? name : short;
}

/** Every player's name the screen shows: the adds, the stashes and the member's roster. */
export function namesOnScreen(
	advice: Pick<WaiverAdvice, 'rows' | 'pickups' | 'roster'> & Partial<Pick<WaiverAdvice, 'stash'>>
): string[] {
	return [...advice.rows, ...advice.pickups, ...(advice.stash ?? [])]
		.map((r) => r.add.player.name)
		.concat(advice.roster.map((l) => l.player.name));
}

/** The strip's cards in the API's order, each one's week gain his over the cards before him, or null
 * where the API withholds it (its season Gain order). Never re-ordered here. */
export function pickupCards(
	advice: Pick<WaiverAdvice, 'rows' | 'pickups' | 'roster'>
): PickupCard[] {
	const names = namesOnScreen(advice);
	return advice.pickups.map((source) => ({
		key: addKey(source),
		slot: positionWord(source.add.player.position),
		add: cardName(source.add.player.name, names),
		drop: source.drop ? cardName(source.drop.player.name, names) : null,
		dropWhy: dropWhy(source),
		weekGain: source.week_gain,
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
 * drop Saints (IR, on your bench)." */
export function stripDecision(
	cards: readonly (Pick<PickupCard, 'add' | 'drop'> & Partial<Pick<PickupCard, 'dropWhy'>>)[]
): string {
	const said = cards.map((c) => {
		const why = dropWhyWords(c.dropWhy ?? null);
		return why === null ? moveWords(c) : `${moveWords(c)} ${why}`;
	});
	return [pickupsTitle(cards.length), ...said].join('. ') + '.';
}

/** "(IR, on your bench)" after a card's move, null without a reason to say. */
export function dropWhyWords(why: string | null): string | null {
	return why === null ? null : `(${why})`;
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
				weekGain: drop.week_gain,
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
		week_gain: drop.weekGain
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

/** The table's default: Beats, by the season Gain, the API's own order among the rows that gain. */
export const DEFAULT_SORT: Sort = { key: 'beats', down: true };

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
			return r.order;
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
 * yours", the five the rows that gain, those over the divider (Lane 98, B13). */
export function countWords(rows: readonly Pick<PoolRow, 'gains'>[], host: LeagueHost): string {
	const n = rows.length;
	const beating = rows.filter((r) => r.gains).length;
	return `${String(n)} free ${n === 1 ? 'agent' : 'agents'} we rank on ${hostWords(host)}, ${String(beating)} ${beating === 1 ? 'beats' : 'beat'} a player of yours`;
}

/** One head of the line under the column heads (B35): the head as it prints, then what it is. */
export interface HeadBasisPart {
	head: string;
	words: string;
}

/** The line under the column heads (Lane 98, B35), said there once: "A game is our rest-of-season
 * points a game, Avg his season average, Δ Proj his Proj's change since Sun 2:00 pm, Beats the player
 * he would replace." Δ Proj only while the column is drawn and there is a read before to count from. */
export function headBasis(
	previousReadAt: string | null,
	projected: boolean,
	clock: Clock
): HeadBasisPart[] {
	const delta =
		projected && previousReadAt !== null
			? [{ head: BOX.delta, words: HEAD_BASIS.delta(stamp(previousReadAt, clock)) }]
			: [];
	return [
		{ head: WAIVERS.rest, words: HEAD_BASIS.rest },
		{ head: BOX.avg, words: HEAD_BASIS.avg },
		...delta,
		{ head: WAIVERS.beats, words: HEAD_BASIS.beats }
	];
}

/** Between the heads' parts: a comma, the site's copy carrying no semicolon. */
export const HEAD_SEPARATOR = ', ';

/** The line under the heads as one sentence reads, for the copy guard and a screen reader. */
export function headBasisText(parts: readonly HeadBasisPart[]): string {
	return `${parts.map((p) => `${p.head} ${p.words}`).join(HEAD_SEPARATOR)}.`;
}

/** The API's season basis without its sentence for the A game head, which the line under the heads
 * says (B35: the basis said once). */
export function seasonBasisWords(seasonBasis: string): string {
	const head = `${WAIVERS.rest} is `;
	return seasonBasis
		.split(/(?<=\.)\s+/)
		.filter((sentence) => !sentence.startsWith(head))
		.join(' ');
}

/** Whether the basis says why a card's drop is the one named: a card names one under the week's rule
 * (the API's season order withholds its week figures, and its sentence says no drop). */
function dropsSaid(pickups: readonly WaiverRow[]): boolean {
	return pickups.some((p) => p.drop !== null && p.week_gain !== null);
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
		| 'projection_read_at'
		| 'projection_previous_read_at'
		| 'projection_scoring'
	> &
		Partial<
			Pick<
				WaiverAdvice,
				'pickups' | 'week' | 'for_week' | 'projection_arrives_at' | 'basis_note_list'
			>
		>,
	lines: readonly PlayerLine[],
	clock: Clock,
	now: number
): BasisPart[] {
	const defense = lines.some((l) => l.player.position === 'DEF');
	// Before the week's projection is read the screen draws no Proj column and says the day it
	// arrives over the table (WaiverScreen, Lane 95), so the basis says nothing of Proj.
	const arrives =
		advice.week === undefined
			? null
			: arrivesPart(
					advice,
					addressedWeek({ week: advice.week, for_week: advice.for_week }),
					clock.zone
				);
	const projFacts: ProjFacts | null =
		arrives !== null
			? null
			: {
					readAt: advice.projection_read_at,
					scoring: advice.projection_scoring,
					defense,
					league: true,
					// A row past kickoff keeps its Proj as of kickoff (Lane 92, B27).
					kicked: anyKicked(lines, now),
					// A page turned past the platform's week names the week (Lane 111, B70).
					...(advice.week === undefined
						? {}
						: { weeks: { week: advice.week, for_week: advice.for_week } })
				};
	return [
		// The order's rule, the API's: the week's, or the season Gain once a pickup's game kicked off.
		...said(advice.basis),
		// Why a card's drop is the one it names, after the week's rule about a pickup and only where a
		// card names one; at a desk only, the phone's eight lines cannot hold it (review L-C, L-G).
		...said(dropsSaid(advice.pickups ?? []) ? WAIVERS.dropRule : null, false),
		// A game's sentence and Δ Proj's are the line under the heads (headBasis, B35).
		...said(seasonBasisWords(advice.season_basis)),
		// A phone's eight lines leave the defenses' scoring to the desk (Lane 115).
		...(projFacts === null
			? []
			: deskOrPhone(projPart(projFacts, clock), projPhonePart(projFacts, clock))),
		// The phone's rows draw no expected score or weather (BoxLine phoneFacts): no read to say there.
		...said(gamePart(lines, clock, now, 'full'), false),
		...waiverFinalsParts(lines, now),
		...deskOrPhone(OPP_PART, OPP_PHONE),
		...uncountedPart(advice, lines)
	];
}
