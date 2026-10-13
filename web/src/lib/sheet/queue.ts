/**
 * The queue a room starts with: the top of your sheet that is still on the board. The rooms read
 * this, and QUEUE_SEED_SIZE is the one place its length is set.
 */
import type { Sheet } from './model.ts';

/** How many players from your sheet a room queues for you when it opens. */
export const QUEUE_SEED_SIZE = 8;

/** Your sheet's top `size` players still available, in your order. */
export function queueSeed(
	sheet: Sheet,
	available: ReadonlySet<string>,
	size: number = QUEUE_SEED_SIZE
): readonly string[] {
	const out: string[] = [];
	for (const row of sheet.rows) {
		if (out.length === size) break;
		if (available.has(row.id)) out.push(row.id);
	}
	return out;
}
