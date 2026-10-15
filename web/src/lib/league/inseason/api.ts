/** The in-season reads of a followed league (spec §7): this week's lineup, the waiver adds and the
 * trades, each answered for the drafter's own team in the league. */
import { PUBLIC_API_URL } from '$app/env/public';
import { apiClient } from '#lib/api/client.ts';
import type { LineupAdvice, TradeAdvice, WaiverAdvice } from './types.ts';

const client = apiClient(PUBLIC_API_URL);

const path = (id: string, tail: string, query: Record<string, string | null> = {}): string => {
	const kept = Object.entries(query).filter(
		(entry): entry is [string, string] => entry[1] !== null
	);
	const search = new URLSearchParams(kept).toString();
	return `/leagues/attached/${encodeURIComponent(id)}/${tail}${search === '' ? '' : `?${search}`}`;
};

export const inSeasonApi = {
	lineup: (id: string) => client.call<LineupAdvice>(path(id, 'lineup')),
	waivers: (id: string) => client.call<WaiverAdvice>(path(id, 'waivers')),
	/** The trades, narrowed to those holding one player when given (his board id). */
	trades: (id: string, player: string | null = null) =>
		client.call<TradeAdvice>(path(id, 'trades', { player }))
};
