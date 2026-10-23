/** The order's route and query (Lane 66j), pure so the tests read it. */
import type { components, operations } from '#lib/api/types.ts';

type OrderPosition = NonNullable<components['schemas']['PlayerPosition']>;

/** The public order's week rankings (Lane 163, D06): every player on bye in the answer's week after
 * the rest, numbered on from them. */
export type ByesOrder = NonNullable<
	NonNullable<operations['order']['parameters']['query']>['byes']
>;
export const BYES_LAST: ByesOrder = 'last';

/** The roster filter the league's route applies before its limit (review 66j H5). */
export type RosterFilter = 'free' | 'yours';

/** One view of the order: a position or every one, the letters a search holds, the roster filter in
 * a league, and how many rows. */
export interface OrderQuery {
	position: OrderPosition | null;
	q: string | null;
	roster: RosterFilter | null;
	limit: number;
	/** The Players page's week rankings ask for the byes last; the public route alone reads it. */
	byes?: ByesOrder | null;
}

/** The fewest letters a search sends (the API's minimum). */
export const MIN_SEARCH = 2;

/** The kickers' or defenses' week (Lane 66w): the league's with an attached league's id, else the
 * public one. */
export function weekOrderPath(league: string | null, position: 'K' | 'DEF'): string {
	const params = new URLSearchParams({ position });
	const head =
		league === null ? '/order/week' : `/leagues/attached/${encodeURIComponent(league)}/order/week`;
	return `${head}?${params.toString()}`;
}

/** The route's path with its query: the league's order with an attached league's id, else the public
 * one, which takes no roster filter; only the public one takes the byes' order. */
export function orderPath(league: string | null, query: OrderQuery): string {
	const params = new URLSearchParams({ limit: String(query.limit) });
	if (query.position !== null) params.set('position', query.position);
	const q = query.q?.trim() ?? '';
	if (q.length >= MIN_SEARCH) params.set('q', q);
	if (league !== null && query.roster !== null) params.set('roster', query.roster);
	if (league === null && query.byes) params.set('byes', query.byes);
	const head = league === null ? '/order' : `/leagues/attached/${encodeURIComponent(league)}/order`;
	return `${head}?${params.toString()}`;
}
