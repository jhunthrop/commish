/** Sorting a board's rows by a column (Lane 66n): each sortable column's natural direction (a rank
 * or an ADP up, a figure down), the second press turning it, players without the figure last. Pure,
 * so the tests read the order a page prints. */
import { draftersGap } from '#lib/format/draft.ts';
import type { ColumnKey } from './board-columns.ts';

/** The columns a head sorts by. The face, the player, the range and the action do not sort. */
export const SORT_KEYS = [
	'rank',
	'adpLead',
	'tier',
	'bye',
	'proj',
	'vor',
	'adp',
	'ourRank',
	'gap',
	'gp',
	'agame'
] as const satisfies readonly ColumnKey[];
export type SortKey = (typeof SORT_KEYS)[number];

export interface Sort {
	key: SortKey;
	/** Turned from the column's natural direction. */
	turned: boolean;
}

/** What a sort reads from a row. */
export interface Sortable {
	ourRank: number;
	adp: number | null;
	tier: number;
	projected: number;
	vor: number;
	team: string;
	season?: { games: number; pointsPerGame: number | null };
}

/** A figure up (a rank, an ADP, a tier, a bye) or down (points, value, the gap, games). */
const ASCENDING: ReadonlySet<SortKey> = new Set([
	'rank',
	'adpLead',
	'tier',
	'bye',
	'adp',
	'ourRank'
]);

export function isSortKey(key: string): key is SortKey {
	return (SORT_KEYS as readonly string[]).includes(key);
}

/** The order a press on a head gives: its natural direction, or turned when it already sorts. */
export function pressed(current: Sort, key: SortKey): Sort {
	return current.key === key ? { key, turned: !current.turned } : { key, turned: false };
}

function figure(
	row: Sortable,
	key: SortKey,
	byes: Readonly<Record<string, number | null>>
): number | null {
	switch (key) {
		case 'rank':
		case 'ourRank':
			return row.ourRank;
		case 'adpLead':
		case 'adp':
			return row.adp;
		case 'tier':
			return row.tier;
		case 'bye':
			return byes[row.team] ?? null;
		case 'proj':
			return row.projected;
		case 'vor':
			return row.vor;
		case 'gap':
			return draftersGap(row.adp, row.ourRank);
		case 'gp':
			return row.season?.games ?? null;
		case 'agame':
			return row.season?.pointsPerGame ?? null;
	}
}

/** The rows in the sort's order, a new array. Ties keep the page's order, and a row without the
 * figure (no ADP, no game yet) sits last either way. */
export function sortRows<R extends Sortable>(
	rows: readonly R[],
	sort: Sort,
	byes: Readonly<Record<string, number | null>>
): R[] {
	const up = ASCENDING.has(sort.key) !== sort.turned;
	return rows
		.map((row, i) => ({ row, i, value: figure(row, sort.key, byes) }))
		.sort((a, b) => {
			if (a.value === null || b.value === null) {
				return a.value === b.value ? a.i - b.i : a.value === null ? 1 : -1;
			}
			const by = up ? a.value - b.value : b.value - a.value;
			return by === 0 ? a.i - b.i : by;
		})
		.map(({ row }) => row);
}
