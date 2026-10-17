/** The Lineup screen as one lineup table (Lane 66e): the lineup the advice sets slot by slot, the
 * players it moves in marked, then Totals, the bench with the starters it sits marked, and the
 * injured reserve; a decision strip above it naming each swap and the Proj it adds over the lineup
 * as the platform has it set now; one evidence line per swap built from the row's own columns.
 * Pure, tested in lineup.test.ts. */
import { memberZone } from '#lib/format/clock.ts';
import { lastName } from '#lib/format/draft.ts';
import { designationWord } from '#lib/format/designation.ts';
import { fixed } from '#lib/format/number.ts';
import type { LeagueHost } from '../api.ts';
import type { LineupAdvice, LineupSlot } from '../inseason/api.ts';
import { hostWords } from '../names.ts';
import { satIds } from '../inseason/words.ts';
import {
	BOX,
	boxNumber,
	boxRow,
	oppRankWord,
	projTotal,
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
	/** The advised lineup's projection and points so far. */
	totals: BoxTotals;
	/** The lineup as the platform has it set now: its projection, as printed and summed. */
	asSet: number | null;
	/** What the swaps add, with to without, one decimal; null without both totals. */
	gain: number | null;
}

/** Every word the Lineup's strip and verb print, in one place for the copy guard. */
export const LINEUP = {
	make: 'Make these changes',
	copy: 'Copy the lineup',
	set: 'Your lineup is set',
	sit: 'Sit',
	pastWeeks: 'Past weeks on Our record'
} as const;

/** A name's second mention: "Stroud", and a defense by its club ("Saints" from "Saints D/ST"). */
function shortName(name: string): string {
	return lastName(name.replace(/\s+D\/ST$/, ''));
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** "Three changes", "One change", "12 changes", or "Your lineup is set". */
export function changesTitle(n: number): string {
	if (n === 0) return LINEUP.set;
	const word = NUMBER_WORDS[n] ?? String(n);
	return `${word} ${n === 1 ? 'change' : 'changes'}`;
}

/** The strip's sum, its figure drawn large: "87.0" then "Proj with them, 77.5 as set, +9.5", or
 * "Proj as set" with no change; null before the week's projection. */
export interface StripSum {
	figure: string;
	words: string;
	gain: string | null;
}

export function stripSum(
	box: Pick<LineupBox, 'totals' | 'asSet' | 'gain' | 'swaps'>
): StripSum | null {
	if (box.totals.proj === null) return null;
	const figure = boxNumber(box.totals.proj);
	if (box.swaps.length === 0) return { figure, words: `${BOX.proj} as set`, gain: null };
	const set = box.asSet === null ? '' : `, ${boxNumber(box.asSet)} as set`;
	const gain = box.gain === null || box.gain <= 0 ? null : `+${fixed(box.gain, 1)}`;
	return { figure, words: `${BOX.proj} with them${set}`, gain };
}

/** The position an opponent's rank is against, in a sentence. */
const AGAINST: Readonly<Record<string, string>> = {
	QB: 'quarterbacks',
	RB: 'running backs',
	WR: 'receivers',
	TE: 'tight ends',
	K: 'kickers',
	'D/ST': 'defenses'
};

/** The one evidence line a swap opens to (Lane 66e), from the columns: "18.5 Proj against Stroud's
 * 16.8, Questionable, at ATL 24th against quarterbacks.", the bye or the designation that sits the
 * starter named first when it is why. */
export function whyLine(into: BoxRow, out: BoxRow | null, slot: string): string {
	const name = shortName(into.name);
	if (out === null) return `Your ${slot} spot is empty, so ${name} starts.`;
	const sat = shortName(out.name);
	const next =
		into.proj === null
			? `${name} is next in our order, with no ${BOX.proj} this week.`
			: `${name} is the next ${slot} with a ${BOX.proj}, ${boxNumber(into.proj)}.`;
	if (out.game === 'bye') return `${sat} is on bye. ${next}`;
	if (out.status !== null && out.status.mark !== designationWord('questionable'))
		return `${sat} is listed ${out.status.mark.toLowerCase()}. ${next}`;
	if (into.proj === null || out.proj === null) return next;
	const parts = [`${boxNumber(into.proj)} ${BOX.proj} against ${sat}'s ${boxNumber(out.proj)}`];
	if (into.status) parts.push(into.status.mark);
	const against = AGAINST[into.position];
	if (into.game !== null && into.game !== 'bye' && into.evidence.oppRank !== null && against) {
		parts.push(`${into.game.where} ${oppRankWord(into.evidence.oppRank)} against ${against}`);
	}
	return `${parts.join(', ')}.`;
}

/** The lineup as the platform has it set now: each slot's player there, a swap's starter where the
 * advice changes it. */
function setRows(placed: readonly Placed[], sat: ReadonlyMap<string, BoxRow>): BoxRow[] {
	return placed.flatMap(({ slot, row }) => {
		if (!slot.changed) return [row];
		const host = slot.host ? sat.get(slot.host.player.host_id) : undefined;
		return host ? [host] : [];
	});
}

/** One starting spot: the platform's slot and our row for it. */
interface Placed {
	slot: LineupSlot;
	row: BoxRow;
}

const TENTHS = 10;

export function lineupBox(
	advice: Pick<
		LineupAdvice,
		'slots' | 'bench' | 'reserve' | 'player_points' | 'team_points' | 'projection_read_at' | 'week'
	>,
	zone: string = memberZone()
): LineupBox {
	const sat = satIds(advice.slots);
	const placed = advice.slots.map((slot): Placed => ({
		slot,
		row: boxRow(slot.ours, slotWord(slot.slot), zone, false)
	}));
	const ours = placed.map((p) => p.row);
	const satRows = new Map(
		advice.slots.flatMap((slot) =>
			slot.changed && slot.host
				? [[slot.host.player.host_id, boxRow(slot.host, LINEUP.sit, zone, false)] as const]
				: []
		)
	);
	const starters = placed.map(({ slot, row }): LineupRow => {
		if (!slot.changed) return { row, move: null, why: null };
		const out = slot.host ? (satRows.get(slot.host.player.host_id) ?? null) : null;
		return { row, move: 'in', why: whyLine(row, out, row.slot) };
	});
	const bench = advice.bench.map((line): LineupRow => {
		const out = sat.has(line.player.host_id);
		return {
			row: boxRow(line, out ? LINEUP.sit : '', zone, false),
			move: out ? 'out' : null,
			why: null
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
	const proj = projTotal(ours);
	const asSet = projTotal(setRows(placed, satRows));
	return {
		starters,
		bench,
		reserve: advice.reserve.map((line) => boxRow(line, '', zone, false)),
		swaps,
		totals: {
			proj,
			pts: totalsPts(ours, advice.player_points, advice.team_points),
			note: totalsNote(ours, advice.projection_read_at !== null, advice.week)
		},
		asSet,
		gain: proj === null || asSet === null ? null : Math.round((proj - asSet) * TENTHS) / TENTHS
	};
}

/** The lineup as the copy verb puts it on the clipboard: the week, then a slot and a name a line. */
export function lineupText(box: Pick<LineupBox, 'starters'>, week: number): string {
	const lines = box.starters.map(({ row }) => `${row.slot} ${row.name}`);
	return [`Week ${String(week)} lineup`, ...lines].join('\n');
}

/** Where the copied lineup goes, said once it is on the clipboard. */
export function copiedWords(host: LeagueHost): string {
	return `Copied. Paste it on ${hostWords(host)}'s lineup page.`;
}

/** Said when the browser would not copy it. */
export function copyFailedWords(host: LeagueHost): string {
	return `This browser would not copy it. Set it on ${hostWords(host)}'s lineup page.`;
}
