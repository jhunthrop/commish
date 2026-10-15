/** The in-season reads of a followed league (spec §7), typed from the generated contract: this
 * week's lineup, the waiver adds (a position at a time when asked) and the trades (those holding
 * one player when asked), each for the drafter's own team. */
import { PUBLIC_API_URL } from '$app/env/public';
import { apiClient } from '#lib/api/client.ts';
import type { components, operations } from '#lib/api/types.ts';

type Schemas = components['schemas'];
export type LineupAdvice = Schemas['LineupAdvice'];
export type LineupSlot = Schemas['LineupSlot'];
export type WaiverAdvice = Schemas['WaiverAdvice'];
export type WaiverRow = Schemas['WaiverRow'];
export type TradeAdvice = Schemas['TradeAdvice'];
export type TradeTeam = Schemas['TradeTeam'];
export type TradeRow = Schemas['TradeRow'];
export type PlayerLine = Schemas['PlayerLine'];
export type WeekFacts = Schemas['WeekFacts'];
export type InjuryDesignation = Schemas['InjuryDesignation'];
export type GamePoints = Schemas['GamePoints'];
export type OrderBasis = Schemas['OrderBasis'];
/** A position the waiver route narrows to. */
export type WaiverPosition = NonNullable<
	NonNullable<operations['leagueWaivers']['parameters']['query']>['position']
>;

/** The head every answer carries: the week, the honesty line, the order and its stamps. */
export type AdviceHead = Pick<
	LineupAdvice,
	'week' | 'basis' | 'order_basis' | 'refreshed' | 'read_at'
>;

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
	waivers: (id: string, position: WaiverPosition | null = null) =>
		client.call<WaiverAdvice>(path(id, 'waivers', { position })),
	/** The trades, narrowed to those holding one player when given (his board id). */
	trades: (id: string, player: string | null = null) =>
		client.call<TradeAdvice>(path(id, 'trades', { player }))
};
