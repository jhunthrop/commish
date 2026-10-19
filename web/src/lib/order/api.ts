/** Our rest-of-season order with each player's week (Lane 66j), typed from the generated contract:
 * the Rest of season and Players screens read it, for the member's league when one is selected (with
 * each player's roster and the move his row admits) and for a 12-team PPR league otherwise. */
import { PUBLIC_API_URL } from '$app/env/public';
import { apiClient } from '#lib/api/client.ts';
import type { components, operations } from '#lib/api/types.ts';
import { orderPath, weekOrderPath, type OrderQuery } from './path.ts';
import type { WeekPosition } from './week-head.ts';

export type OrderAdvice = components['schemas']['OrderAdvice'];
/** The kickers' and defenses' week (Lane 66w). */
export type WeekOrderAdvice = components['schemas']['WeekOrderAdvice'];
export type WeekOrderRow = components['schemas']['WeekOrderRow'];
export type OrderRow = components['schemas']['OrderRow'];
export type RosterMark = components['schemas']['RosterMark'];
/** A position the order narrows to. */
export type OrderPosition = NonNullable<
	NonNullable<operations['order']['parameters']['query']>['position']
>;

const client = apiClient(PUBLIC_API_URL);

export const orderApi = {
	read: (league: string | null, query: OrderQuery) =>
		client.call<OrderAdvice>(orderPath(league, query))
};

export const weekOrderApi = {
	read: (league: string | null, position: WeekPosition) =>
		client.call<WeekOrderAdvice>(weekOrderPath(league, position))
};
