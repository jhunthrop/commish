/** Compare's two-column stat table, row by row (Lane 66n): the player card's figures for each side,
 * the leader first, and which of the two is better where a row has a better (a rank lower, points
 * higher). A player on a season-long list shows his rank as the word and wins no rank row, since his
 * figures assume he plays. Pure, so the tests read the table the page prints. */
import { draftersGap } from '#lib/format/draft.ts';
import { rankWord } from '#lib/format/designation.ts';
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
}

export interface CompareRow {
	label: string;
	cells: readonly [CompareCell, CompareCell];
	/** The floor to ceiling row: the page draws each side's bar, not text. */
	range?: true;
}

const NONE = 'None';

/** Which is better: 'up' a higher figure, 'down' a lower one, null no better at all. */
type Better = 'up' | 'down' | null;

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
		text: value === null ? NONE : text(value),
		wins: judged ? wins : null
	});
	return { label, cells: [cell(a, aWins), cell(b, judged && !aWins)] };
}

function gapText(gap: number): string {
	return gap === 0 ? '0' : signed(gap, 0);
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
	const gap = (side: Side): number | null =>
		heldRank(side) === null ? draftersGap(side.numbers.adp, side.numbers.ourRank) : null;
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
			'Projected',
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
		{
			label: 'Floor to ceiling',
			cells: [
				{ text: '', wins: null },
				{ text: '', wins: null }
			],
			range: true
		},
		figures(
			'ADP',
			pairOf((side) => side.numbers.adp),
			(v) => fixed(v),
			null
		),
		figures('Gap', pairOf(gap), gapText, null),
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
				'A game',
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
			`${String(season - 1)} a game`,
			pairOf((side) => side.player.lastSeason?.pointsPerGame ?? null),
			(v) => fixed(v),
			'up'
		)
	);
	return rows;
}
