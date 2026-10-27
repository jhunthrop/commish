/** A player's one number in our order (Lane 234, B233; Lane 227, B209): his place in the full order
 * of the view before any byes-last move, so the Rankings, home, a club page, compare and the player
 * page say one number for him. The Rankings with the byes last keep each row's `rank` as the place it
 * is drawn in, and never print it. Imports nothing but types, so every reader carries it. */
import type { components } from '#lib/api/types.ts';

type OrderRow = components['schemas']['OrderRow'];

/** His number: the answer's overall_rank; on an answer from before the field (the API one deploy
 * behind, the deploy window) his rank, which is the same number on every read without byes=last. */
export function overallOf(row: Pick<OrderRow, 'rank' | 'overall_rank'>): number {
	return row.overall_rank ?? row.rank;
}
