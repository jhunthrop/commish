/** A position's tiers and each tier's drop to the next as the run writes it (Lane 66q): the board's
 * position views, the player page's tier mates and the jump list read them. Apart from derive.ts, which
 * every nightly page loads, so only the pages that draw tiers carry them (vite.config.ts). */
import type { Position } from '#lib/types/player.ts';
import type { TierCliff } from '#lib/ui/tier.ts';
import { rowsAt } from './derive.ts';
import type { BoardRow } from './schema.ts';

export interface TierGroup<R extends BoardRow = BoardRow> {
	tier: number;
	rows: R[];
	cliff: TierCliff | null;
}

/** A position's tiers in order, each with its players shown and its drop to the next tier as the run
 * writes it (`tierDrop`, the web never subtracts). `out` leaves a player out of the tiers (a held
 * player, Lane 63), who counts toward no drop: a drop whose edge he stands on is not said. The last
 * tier and a run older than the column have no drop. */
export function tierGroups<R extends BoardRow>(
	rows: readonly R[],
	position: Position,
	out: (row: R) => boolean = () => false
): TierGroup<R>[] {
	const all = rowsAt(rows, position);
	const groups: TierGroup<R>[] = [];
	for (const row of all.filter((r) => !out(r))) {
		const last = groups.at(-1);
		if (last?.tier === row.tier) last.rows.push(row);
		else groups.push({ tier: row.tier, rows: [row], cliff: shownDrop(all, row.tier, out) });
	}
	return groups;
}

/** The run's drop from a tier to the very next, said only where it measures the players shown: neither
 * the tier's last player nor the next tier's first is left out. */
function shownDrop<R extends BoardRow>(
	all: readonly R[],
	tier: number,
	out: (row: R) => boolean
): TierCliff | null {
	const end = all.findLast((row) => row.tier === tier);
	const start = all.find((row) => row.tier === tier + 1);
	const drop = end?.tierDrop;
	return end && start && !out(end) && !out(start) && drop !== undefined && drop !== null
		? { drop, nextTier: tier + 1, nextId: start.id }
		: null;
}
