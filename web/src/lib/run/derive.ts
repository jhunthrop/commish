/** What every nightly page derives from a board, in one place: tiers and their drops, the range
 * scale rows share, the positions a board carries, the URL segment of a position. */
import { POSITIONS, type Position, type RangeScale } from '#lib/types/player.ts';
import type { GroupName, TierCliff } from '#lib/ui/tier.ts';
import type { BoardRow } from './schema.ts';

/** A range scale starts at the floor rounded down to this many points. */
const SCALE_STEP = 25;

export const POSITION_NAMES: Readonly<Record<Position, GroupName>> = {
	QB: { one: 'QB', many: 'QBs' },
	RB: { one: 'RB', many: 'RBs' },
	WR: { one: 'WR', many: 'WRs' },
	TE: { one: 'TE', many: 'TEs' },
	K: { one: 'kicker', many: 'kickers' },
	DST: { one: 'defense', many: 'defenses' }
};

/** The URL segment of a position view: /board/ppr-12/wr. */
export function positionSegment(position: Position): string {
	return position.toLowerCase();
}

export function positionFromSegment(segment: string): Position | null {
	return POSITIONS.find((position) => positionSegment(position) === segment) ?? null;
}

/** The positions a board ranks, in the board order QB, RB, WR, TE, K, DST. */
export function positionsIn(rows: readonly BoardRow[]): Position[] {
	const present = new Set(rows.map((row) => row.position));
	return POSITIONS.filter((position) => present.has(position));
}

/** A position's rows, best first. */
export function rowsAt<R extends BoardRow>(rows: readonly R[], position: Position): R[] {
	return rows
		.filter((row) => row.position === position)
		.sort((a, b) => a.positionRank - b.positionRank);
}

export interface TierGroup<R extends BoardRow = BoardRow> {
	tier: number;
	rows: R[];
	cliff: TierCliff | null;
}

/** A position's tiers in order, each with its players and the drop in projected points from its
 * last player to the next tier's first. The last tier has no drop. */
export function tierGroups<R extends BoardRow>(
	rows: readonly R[],
	position: Position
): TierGroup<R>[] {
	const groups: TierGroup<R>[] = [];
	for (const row of rowsAt(rows, position)) {
		const last = groups.at(-1);
		if (last?.tier === row.tier) last.rows.push(row);
		else groups.push({ tier: row.tier, rows: [row], cliff: null });
	}
	return groups.map((group, i) => {
		const next = groups[i + 1];
		const end = group.rows.at(-1);
		const start = next?.rows[0];
		return next && end && start
			? { ...group, cliff: { drop: end.projected - start.projected, nextTier: next.tier } }
			: group;
	});
}

/** The tier group a player sits in. */
export function tierOf(rows: readonly BoardRow[], player: BoardRow): TierGroup {
	const group = tierGroups(rows, player.position).find((g) => g.tier === player.tier);
	if (!group) throw new Error(`${player.name} is in no tier of his position.`);
	return group;
}

/** The scale every range bar in one view shares, so spans compare across rows. */
export function rangeScale(rows: readonly Pick<BoardRow, 'floor' | 'ceiling'>[]): RangeScale {
	if (rows.length === 0) throw new Error('A range scale needs at least one row.');
	const lo = Math.floor(Math.min(...rows.map((row) => row.floor)) / SCALE_STEP) * SCALE_STEP;
	const hi = Math.max(...rows.map((row) => row.ceiling));
	return { lo, hi: hi > lo ? hi : lo + SCALE_STEP };
}
