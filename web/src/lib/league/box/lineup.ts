/** The Lineup screen as one lineup table (Lane 66e): the lineup the advice sets slot by slot, the
 * players it moves in marked, then Totals, the bench with the starters it sits marked, and the
 * injured reserve; a decision strip above it naming each swap, each spot no one who can play fills,
 * and the Proj the swaps add over the lineup as the platform has it set now; one evidence line per
 * swap built from the row's own columns. Pure, tested in lineup.test.ts. */
import { FREE_AGENT_WORDS } from '#lib/format/free-agent.ts';
import { lastName } from '#lib/format/draft.ts';
import { fixed } from '#lib/format/number.ts';
import type { LeagueHost } from '../api.ts';
import type { LineupAdvice, LineupSlot, PlayerLine, WeekDoneState } from '../inseason/api.ts';
import { linesRead, pastKickoff } from './kickoff.ts';
import { hostWords } from '../names.ts';
import { satIds } from '../inseason/words.ts';
import {
	BOX,
	boxNumber,
	boxRow,
	easeOf,
	heldGame,
	oppRankWord,
	projTotal,
	RANKED_CLUBS,
	slotWord,
	totalsNote,
	totalsPts,
	type BoxRow,
	type BoxTotals
} from './box.ts';

/** A row the advice moves: in to the lineup, or out of it to the bench. */
export type Move = 'in' | 'out';

export interface LineupRow {
	row: BoxRow;
	move: Move | null;
	/** The one evidence line a moved-in row opens to, built from the columns; null off a swap. */
	why: string | null;
	/** A spot no rostered player who can play this week fills: the member's player, left there. */
	idle: boolean;
}

/** One swap as the strip names it: "Williams in, Stroud out" at QB. */
export interface Swap {
	key: string;
	slot: string;
	in: string;
	out: string | null;
}

export interface LineupBox {
	starters: LineupRow[];
	bench: LineupRow[];
	reserve: BoxRow[];
	swaps: Swap[];
	/** The strip's line for each spot no one who can play fills: "TE: no one on your roster can play
	 * this week". */
	idle: string[];
	/** Spots empty on the platform that no one who can play fills: their slot words, each drawn as a
	 * row with no player (review N2). */
	empty: string[];
	/** The advised lineup's projection and points so far, a spot no one can play counted at 0. */
	totals: BoxTotals;
	/** The lineup as the platform has it set now: its projection, as printed and summed, a spot no
	 * one can play counted at 0. */
	asSet: number | null;
	/** What the swaps add, with to without, one decimal; null without both totals. */
	gain: number | null;
	/** The lineup as set is under way at the page's clock (linesRead over its starters' games, the
	 * Team row's one rule): one has kicked off and not every one is final (Lane 118, B88). */
	playing: boolean;
}

/** Every word the Lineup's strip and verb print, in one place for the copy guard. */
export const LINEUP = {
	make: 'Make these changes',
	copy: 'Copy the lineup',
	set: 'Your lineup is set',
	sit: 'Sit',
	/** The strip's link to the order's record (Lane 99, B62): it says where it goes. */
	pastWeeks: 'Past weeks of our order',
	copied: 'Copied.',
	setItOn: 'Set it on',
	copyFailed: 'This browser would not copy it.',
	noOneCanPlay: 'no one on your roster can play this week',
	noOneHere: 'No one on your roster can play here this week',
	heldEmpty: 'has kicked off, the spot stays empty',
	/** A swap's two sides, as the strip's chips say them: "Dart in", "Rodgers out". */
	swapIn: 'in',
	swapOut: 'out'
} as const;

/** The Lineup's bench, as a link from another page opens it (the League page's bench count). */
export const BENCH_ANCHOR = 'bench';

/** A name's second mention: "Stroud", and a defense by its club ("Saints" from "Saints D/ST"). */
export function shortName(name: string): string {
	return lastName(name.replace(/\s+D\/ST$/, ''));
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** "Three changes", "One change", "12 changes", or "Your lineup is set"; once the API says every
 * starter of the member's has kicked off (its week_done sentence, said beside it, Lane 109), "Locked"
 * while the matchup still plays and "Final" once it is final (Lane 91). An answer with the sentence and no
 * state, from the previous API, says "Final" as it did. */
export function changesTitle(
	n: number,
	done: string | null = null,
	state: WeekDoneState | null = null
): string {
	if (done !== null) return state === 'locked' ? BOX.locked : BOX.final;
	if (n === 0) return LINEUP.set;
	const word = NUMBER_WORDS[n] ?? String(n);
	return `${word} ${n === 1 ? 'change' : 'changes'}`;
}

/** The strip's sum, its figure drawn large: "87.0" then "Proj with them, 77.5 as set, +9.5", or
 * "Proj as set" with no change; null before the week's projection. asSet names whose lineup the as-set
 * figure is (the Lineup's "as set on ESPN", lineupSum). */
export interface StripSum {
	figure: string;
	words: string;
	gain: string | null;
	/** "Proj final 112.4" beside the moving Pts while the lineup still plays (Lane 118, B88): the
	 * Matchup's projected final, its sentence already in the basis; absent otherwise. */
	final?: string | null;
}

/** The lineup as the platform holds it, in the strip's words. */
const AS_SET = 'as set';

export function stripSum(
	box: Pick<LineupBox, 'totals' | 'asSet' | 'gain' | 'swaps'>,
	done: string | null = null,
	asSet: string = AS_SET
): StripSum | null {
	// Every starter kicked off leaves no Proj to add: the API's sentence stands in the sum's place.
	if (box.totals.proj === null || done !== null) return null;
	const figure = boxNumber(box.totals.proj);
	if (box.swaps.length === 0) return { figure, words: `${BOX.proj} ${asSet}`, gain: null };
	const set = box.asSet === null ? '' : `, ${boxNumber(box.asSet)} ${asSet}`;
	const gain = box.gain === null || box.gain <= 0 ? null : `+${fixed(box.gain, 1)}`;
	return { figure, words: `${BOX.proj} with them${set}`, gain };
}

/** "as set on ESPN": whose lineup the Lineup strip's figure is (Lane 99, B11). */
export function asSetWords(host: LeagueHost): string {
	return `${AS_SET} on ${hostWords(host)}`;
}

/** The Lineup strip's figure (Lane 99, B11), the platform named: stripSum's with "as set on ESPN", or
 * once every starter has kicked off the lineup's points so far, "76.8" and "Pts as set on ESPN"; null with
 * neither figure. */
export function lineupSum(
	box: Pick<LineupBox, 'totals' | 'asSet' | 'gain' | 'swaps' | 'playing'>,
	host: LeagueHost,
	done: string | null
): StripSum | null {
	if (done === null) return stripSum(box, null, asSetWords(host));
	if (box.totals.pts === null) return null;
	return {
		figure: boxNumber(box.totals.pts),
		words: `${BOX.pts} ${asSetWords(host)}`,
		gain: null,
		final: projFinalCell(box)
	};
}

/** "Proj final 112.4" while the lineup as set still plays and the API gives its projected final
 * (projfinal.go, the Matchup's); null once every starter is final or with no figure. */
export function projFinalCell(box: Pick<LineupBox, 'totals' | 'playing'>): string | null {
	const { final } = box.totals;
	return box.playing && final !== null ? `${BOX.projFinal} ${boxNumber(final)}` : null;
}

/** The position an opponent's rank is against, in a sentence. A defense has no rank (the API ranks
 * none), so it has no words. */
export const AGAINST: Readonly<Record<string, string>> = {
	QB: 'quarterbacks',
	RB: 'running backs',
	WR: 'receivers',
	TE: 'tight ends',
	K: 'kickers'
};

/** An opponent's rank with its direction, one rule for both ends: "3rd toughest against
 * quarterbacks" (the bottom third, few points allowed), "31st, among the easiest for receivers"
 * (the top third), "12th of 32 against receivers" between them. */
export function rankWords(rank: number, of: number | null, against: string): string {
	const ord = oppRankWord(rank);
	switch (easeOf(rank, of)) {
		case 'hard':
			return `${ord} toughest against ${against}`;
		case 'easy':
			return `${ord}, among the easiest for ${against}`;
		case 'even':
			return `${ord} of ${String(of ?? RANKED_CLUBS)} against ${against}`;
	}
}

/** A status word inside a sentence: its first letter lowered, so "On the PUP list" reads "on the PUP
 * list". */
function inSentence(word: string): string {
	return word.charAt(0).toLowerCase() + word.slice(1);
}

/** The one evidence line a swap opens to (Lane 66e), from the columns: "18.5 Proj against Stroud's
 * 16.8, Questionable, at ATL, 24th, among the easiest for quarterbacks.", the bye or the designation
 * that sits the starter named first when it is why. */
export function whyLine(into: BoxRow, out: BoxRow | null, slot: string): string {
	const name = shortName(into.name);
	if (out === null) return `Your ${slot} spot is empty, so ${name} starts.`;
	const sat = shortName(out.name);
	const next =
		into.proj === null
			? `${name} is next in our order, with no ${BOX.proj} this week.`
			: `${name} is the next ${slot} with a ${BOX.proj}, ${boxNumber(into.proj)}.`;
	if (out.game === 'bye') return `${sat} is on bye. ${next}`;
	if (out.game === 'no-club') return `${sat} is ${FREE_AGENT_WORDS}. ${next}`;
	if (out.status?.rank != null)
		return `${sat} is on a season-long list, ${out.status.mark}. ${next}`;
	if (out.status !== null && out.status.question !== true)
		return `${sat} is listed ${inSentence(out.status.mark)}. ${next}`;
	if (into.proj === null || out.proj === null) return next;
	const parts = [`${boxNumber(into.proj)} ${BOX.proj} against ${sat}'s ${boxNumber(out.proj)}`];
	if (into.status) parts.push(into.status.mark);
	const against = AGAINST[into.position];
	const rank = into.evidence.oppRank;
	const game = heldGame(into.game);
	if (game !== null) {
		parts.push(game.where);
		if (rank !== null && against) parts.push(rankWords(rank, into.evidence.oppOf, against));
	}
	return `${parts.join(', ')}.`;
}

/** The strip's line for a spot no one who can play fills. */
export function idleWords(slot: string): string {
	return `${slot}: ${LINEUP.noOneCanPlay}`;
}

/** A player whose game is past its kickoff by the API's state (Lane 80): the platform takes no move
 * on him, so no screen draws one (Lane 85). A bye is no game. */
export function locked(line: PlayerLine, now: number): boolean {
	return pastKickoff(line, now);
}

/** A spot the advice would fill that stays empty because its player has kicked off. */
export interface HeldSpot {
	slot: LineupSlot['slot'];
	name: string;
}

/** The advice after heldLineup: the spots its undone changes leave empty, said apart from the spots no
 * one can play (review L2). */
export interface Held {
	held_empty: HeldSpot[];
}

/** The advice with every change on a locked row undone (Lane 85): the API's engine already holds a
 * kicked-off starter where the platform has him (engine.go Lineup), and the web refuses to draw a move
 * mark on such a row whatever it is sent. The platform's starter keeps the spot, the advised starter
 * goes back to the bench, each player placed once however the changes chain (review L1); a change
 * into an empty spot leaves it empty, held_empty saying whose game kicked off. The answer as it came
 * when nothing is undone. */
export function heldLineup<T extends Pick<LineupAdvice, 'slots' | 'bench' | 'empty_slots' | 'set'>>(
	advice: T,
	now: number
): T & Held {
	const undone = undoneSlots(advice.slots, now);
	if (undone.length === 0) return { ...advice, held_empty: [] };
	const slots = advice.slots.flatMap((s): LineupSlot[] => {
		if (!undone.includes(s)) return [s];
		return s.host === null ? [] : [{ ...s, ours: s.host, changed: false, sentence: null }];
	});
	const placed = new Set(slots.map((s) => s.ours.player.host_id));
	const seen = new Set<string>();
	const bench = [...advice.bench, ...undone.map((s) => s.ours)].filter((l) => {
		const id = l.player.host_id;
		if (placed.has(id) || seen.has(id)) return false;
		seen.add(id);
		return true;
	});
	return {
		...advice,
		slots,
		bench,
		held_empty: undone.flatMap((s) =>
			s.host === null ? [{ slot: s.slot, name: shortName(s.ours.player.name) }] : []
		),
		set: slots.every((s) => !s.changed)
	};
}

/** The changes heldLineup undoes: each on a locked row, then each that moves a player an undone change
 * hands back to his own spot, until none is left (review L-A: a partly locked chain places him once). */
function undoneSlots(slots: readonly LineupSlot[], now: number): LineupSlot[] {
	const undone = new Set(
		slots.filter(
			(s) => s.changed && (locked(s.ours, now) || (s.host !== null && locked(s.host, now)))
		)
	);
	for (let grew = true; grew;) {
		grew = false;
		const returned = new Set([...undone].flatMap((s) => (s.host ? [s.host.player.host_id] : [])));
		for (const s of slots) {
			if (s.changed && !undone.has(s) && returned.has(s.ours.player.host_id)) {
				undone.add(s);
				grew = true;
			}
		}
	}
	return slots.filter((s) => undone.has(s));
}

/** The strip's line for a spot an undone change leaves empty: "QB: Dart has kicked off, the spot
 * stays empty". */
export function heldWords(spot: HeldSpot): string {
	return `${slotWord(spot.slot)}: ${spot.name} ${LINEUP.heldEmpty}`;
}

/** One starting spot: the platform's slot and our row for it. */
interface Placed {
	slot: LineupSlot;
	row: BoxRow;
}

/** The lineup as the platform has it set now: each slot's player there, a swap's starter where the
 * advice changes it, a spot no one can play left out (it counts 0). */
function setRows(placed: readonly Placed[], sat: ReadonlyMap<string, BoxRow>): BoxRow[] {
	return placed.flatMap(({ slot, row }) => {
		if (slot.no_one_can_play) return [];
		if (!slot.changed) return [row];
		const host = slot.host ? sat.get(slot.host.player.host_id) : undefined;
		return host ? [host] : [];
	});
}

const TENTHS = 10;

export function lineupBox(
	advice: Pick<
		LineupAdvice,
		| 'slots'
		| 'empty_slots'
		| 'bench'
		| 'reserve'
		| 'player_points'
		| 'team_points'
		| 'projection_read_at'
		| 'week'
	> &
		Partial<Pick<LineupAdvice, 'projected_final'>> &
		Partial<Held>,
	zone: string,
	now: number
): LineupBox {
	const sat = satIds(advice.slots);
	const placed = advice.slots.map((slot): Placed => ({
		slot,
		row: boxRow(slot.ours, slotWord(slot.slot), zone, true, now)
	}));
	const ours = placed.map((p) => p.row);
	const counted = placed.flatMap((p) => (p.slot.no_one_can_play ? [] : [p.row]));
	const satRows = new Map(
		advice.slots.flatMap((slot) =>
			slot.changed && slot.host
				? [[slot.host.player.host_id, boxRow(slot.host, LINEUP.sit, zone, true, now)] as const]
				: []
		)
	);
	const starters = placed.map(({ slot, row }): LineupRow => {
		const idle = slot.no_one_can_play;
		if (!slot.changed) return { row, move: null, why: null, idle };
		const out = slot.host ? (satRows.get(slot.host.player.host_id) ?? null) : null;
		return { row, move: 'in', why: whyLine(row, out, row.slot), idle };
	});
	const bench = advice.bench.map((line): LineupRow => {
		const out = sat.has(line.player.host_id);
		return {
			row: boxRow(line, out ? LINEUP.sit : '', zone, true, now),
			move: out ? 'out' : null,
			why: null,
			idle: false
		};
	});
	const swaps = placed.flatMap(({ slot, row }): Swap[] =>
		slot.changed
			? [
					{
						key: slot.ours.player.host_id,
						slot: row.slot,
						in: shortName(slot.ours.player.name),
						out: slot.host ? shortName(slot.host.player.name) : null
					}
				]
			: []
	);
	const proj = projTotal(counted);
	const asSet = projTotal(setRows(placed, satRows));
	const setLines = placed.map((p) => p.slot.host ?? p.slot.ours);
	const read = linesRead(setLines, now);
	return {
		starters,
		bench,
		reserve: advice.reserve.map((line) => boxRow(line, '', zone, true, now)),
		swaps,
		idle: [
			...[
				...placed.flatMap((p) => (p.slot.no_one_can_play ? [p.row.slot] : [])),
				...advice.empty_slots.map(slotWord)
			].map(idleWords),
			...(advice.held_empty ?? []).map(heldWords)
		],
		empty: [...advice.empty_slots, ...(advice.held_empty ?? []).map((h) => h.slot)].map(slotWord),
		totals: {
			proj,
			pts: totalsPts(ours, advice.player_points, advice.team_points),
			final: advice.projected_final ?? null,
			live: setLines.some((line) => pastKickoff(line, now)),
			allFinal: read.state === 'final',
			note: totalsNote(counted, advice.projection_read_at !== null, advice.week)
		},
		asSet,
		gain: proj === null || asSet === null ? null : Math.round((proj - asSet) * TENTHS) / TENTHS,
		playing: read.state === 'playing'
	};
}

/** The lineup as the copy verb puts it on the clipboard: the week, then a slot and a name a line. */
export function lineupText(box: Pick<LineupBox, 'starters'>, week: number): string {
	const lines = box.starters.map(({ row }) => `${row.slot} ${row.name}`);
	return [`Week ${String(week)} lineup`, ...lines].join('\n');
}

/** "Sleeper's lineup page": the copy verb's second half, a link where the API knows the page. */
export function lineupPageWords(host: LeagueHost): string {
	return `${hostWords(host)}'s lineup page`;
}

/** The line once the copy verb is pressed: what happened, then "Set it on Sleeper's lineup page.",
 * the page its link; never a paste, which no platform takes. */
export interface CopyLine {
	said: string;
	page: string;
}

export function copiedLine(host: LeagueHost, copied: boolean): CopyLine {
	return { said: copied ? LINEUP.copied : LINEUP.copyFailed, page: lineupPageWords(host) };
}

/** Said when the lineup is set and the platform takes our writes: "Lineup set on ESPN". */
export function setOnWords(host: LeagueHost): string {
	return `Lineup set on ${hostWords(host)}`;
}

/** The swap the advice makes with him, in or out, by his row; null when it makes none. */
export function swapOf(swaps: readonly Swap[], row: Pick<BoxRow, 'key' | 'name'>): Swap | null {
	const short = shortName(row.name);
	return swaps.find((swap) => swap.key === row.key || swap.out === short) ?? null;
}

/** A swap in the strip's words: "QB, Dart in, Rodgers out". */
export function swapWords(swap: Swap): string {
	const into = `${swap.slot}, ${swap.in} ${LINEUP.swapIn}`;
	return swap.out === null ? into : `${into}, ${swap.out} ${LINEUP.swapOut}`;
}
