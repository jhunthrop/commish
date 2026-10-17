/** The order's route and query (Lane 66j), pure so the tests read it. */
import type { components } from '#lib/api/types.ts';

type OrderPosition = NonNullable<components['schemas']['PlayerPosition']>;

/** One view of the order: a position or every one, the letters a search holds, and how many rows. */
export interface OrderQuery {
	position: OrderPosition | null;
	q: string | null;
	limit: number;
}

/** The fewest letters a search sends (the API's minimum). */
export const MIN_SEARCH = 2;

/** The route's path with its query: the league's order with an attached league's id, else the public one. */
export function orderPath(league: string | null, query: OrderQuery): string {
	const params = new URLSearchParams({ limit: String(query.limit) });
	if (query.position !== null) params.set('position', query.position);
	const q = query.q?.trim() ?? '';
	if (q.length >= MIN_SEARCH) params.set('q', q);
	const head = league === null ? '/order' : `/leagues/attached/${encodeURIComponent(league)}/order`;
	return `${head}?${params.toString()}`;
}
