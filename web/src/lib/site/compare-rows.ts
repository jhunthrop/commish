/** Compare's two-column stat table, row by row (Lane 66n): the player card's figures for each side,
 * the leader first, and which of the two is better where a row has a better (a rank lower, points
 * higher). A player on a season-long list shows his rank as the word and wins no rank row, since his
 * figures assume he plays. Pure, so the tests read the table the page prints. */
import { carriesGap, gapText, gapTone, type GapTone } from '#lib/format/gap.ts';
import { rankWord } from '#lib/format/designation.ts';
import { EMPTY_FIGURE } from '#lib/format/empty.ts';
import { FIGURE } from '#lib/format/figure-words.ts';
import { fixed, signed } from '#lib/format/number.ts';
import type { PlayerFormat } from '#lib/run/schema.ts';
import type { PlayerData } from './player-data.ts';

/** One side of the table: the player, his numbers in the compared format, his club's bye. */
export interface Side {
	player: PlayerData;
	numbers: PlayerFormat;
	bye: number | null;
}

export interface CompareCell {
	text: string;
	/** True for the better figure, false for the other, null where the row has no better. */
	wins: boolean | null;
	/** A signed gap's colour, the board row's (format/gap.ts); absent on every other row. */
	tone?: GapTone | null;
}

export interface CompareRow {
	label: string;
	cells: readonly [CompareCell, CompareCell];
	/** The floor to ceiling row: the page draws each side's bar, not text. */
	range?: true;
}

/** Which is better: 'up' a higher figure, 'down' a lower one, null no better at all. */
type Better = 'up' | 'down' | null;

/** A side's floor, median and ceiling when the run carries all three, null otherwise: what the page
 * draws a range bar from and sets the pair's scale by. */
export function sideRange(side: Side): { floor: number; median: number; ceiling: number } | null {
	const { floor, median, ceiling } = side.numbers;
	return floor === null || median === null || ceiling === null ? null : { floor, median, ceiling };
}

function heldRank(side: Side): string | null {
	const status = side.player.status;
	return status?.seasonLong === true ? rankWord(status.status) : null;
}

function figures(
	label: string,
	values: readonly [number | null, number | null],
	text: (value: number) => string,
	better: Better
): CompareRow {
	const [a, b] = values;
	const judged = better !== null && a !== null && b !== null && a !== b;
	const aWins = judged && (better === 'up' ? a > b : a < b);
	const cell = (value: number | null, wins: boolean): CompareCell => ({
		text: value === null ? EMPTY_FIGURE : text(value),
		wins: judged ? wins : null
	});
	return { label, cells: [cell(a, aWins), cell(b, judged && !aWins)] };
}

/** A rank row: the lower rank wins, unless a side is on a season-long list, whose rank is a word. */
function rankRow(
	label: string,
	ranks: readonly [number, number],
	words: readonly [string, string],
	judged: boolean
): CompareRow {
	const [a, b] = figures(label, ranks, String, judged ? 'down' : null).cells;
	return {
		label,
		cells: [
			{ ...a, text: words[0] },
			{ ...b, text: words[1] }
		]
	};
}

export function compareRows(
	first: Side,
	second: Side,
	season: number,
	underway: boolean
): CompareRow[] {
	const pairOf = <T>(read: (side: Side) => T): readonly [T, T] => [read(first), read(second)];
	const held = pairOf(heldRank);
	const judged = held[0] === null && held[1] === null;
	/** The run's Gap, none for a held side: his rank is a word, so no drafts are set against it. */
	const gap = (side: Side): number | null =>
		heldRank(side) === null ? (side.numbers.gap ?? null) : null;
	const gaps = pairOf(gap);
	const gapCell = (value: number | null): CompareCell => ({
		text: gapText(value),
		wins: null,
		tone: gapTone(value)
	});
	/** The Gap row, only when one of the pair carries the run's gap (re-review N1): an older run
	 * carries none, and the table then has no Gap row rather than two empty cells. */
	const gapRow: CompareRow[] = carriesGap(gaps.map((value) => ({ gap: value })))
		? [{ label: 'Gap', cells: [gapCell(gaps[0]), gapCell(gaps[1])] }]
		: [];
	/** The Floor to ceiling row, only when one of the pair carries a range (in season neither does):
	 * the page draws a bar for a side that has one and the empty mark for a side that has none. */
	const ranged = pairOf((side) => sideRange(side) !== null);
	const rangeRow: CompareRow[] =
		ranged[0] || ranged[1]
			? [
					{
						label: 'Floor to ceiling',
						cells: [
							{ text: ranged[0] ? '' : EMPTY_FIGURE, wins: null },
							{ text: ranged[1] ? '' : EMPTY_FIGURE, wins: null }
						],
						range: true
					}
				]
			: [];
	const rows: CompareRow[] = [
		rankRow(
			'Our rank',
			pairOf((side) => side.numbers.ourRank),
			pairOf((side) => heldRank(side) ?? String(side.numbers.ourRank)),
			judged
		),
		rankRow(
			'Position rank',
			pairOf((side) => side.numbers.positionRank),
			pairOf(
				(side) => `${side.player.position} ${heldRank(side) ?? String(side.numbers.positionRank)}`
			),
			judged
		),
		figures(
			FIGURE.projected,
			pairOf((side) => side.numbers.projected),
			(v) => fixed(v),
			'up'
		),
		figures(
			'Over replacement',
			pairOf((side) => side.numbers.vor),
			(v) => signed(v, 1),
			'up'
		),
		...rangeRow,
		figures(
			'ADP',
			pairOf((side) => side.numbers.adp),
			(v) => fixed(v),
			null
		),
		...gapRow,
		figures(
			'Bye',
			pairOf((side) => side.bye),
			String,
			null
		)
	];
	if (underway) {
		rows.push(
			figures(
				FIGURE.avg,
				pairOf((side) => side.player.seasonSoFar?.pointsPerGame ?? null),
				(v) => fixed(v),
				'up'
			),
			figures(
				'GP',
				pairOf((side) => side.player.seasonSoFar?.games ?? null),
				String,
				null
			)
		);
	}
	rows.push(
		figures(
			`${String(season - 1)} ${FIGURE.avg}`,
			pairOf((side) => side.player.lastSeason?.pointsPerGame ?? null),
			(v) => fixed(v),
			'up'
		)
	);
	return rows;
}
