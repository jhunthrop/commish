/** The in-season reads of a followed league (spec §7), typed from the generated contract: this
 * week's lineup, the week's matchup as a box score, the waiver adds (a position at a time when asked) and the trades (those holding
 * one player when asked), each for the drafter's own team; and the moves made on the host, a lineup
 * set or a claim planned in words and then made with its confirm token (spec §10.2). */
import { PUBLIC_API_URL } from '$app/env/public';
import { apiClient } from '#lib/api/client.ts';
import type { components, operations } from '#lib/api/types.ts';

type Schemas = components['schemas'];
export type LineupAdvice = Schemas['LineupAdvice'];
export type LineupSlot = Schemas['LineupSlot'];
export type MatchupBox = Schemas['MatchupBox'];
export type MatchupBoxSide = Schemas['MatchupBoxSide'];
export type WaiverAdvice = Schemas['WaiverAdvice'];
export type WaiverRow = Schemas['WaiverRow'];
export type TradeAdvice = Schemas['TradeAdvice'];
export type TradeTeam = Schemas['TradeTeam'];
export type TradeRow = Schemas['TradeRow'];
export type TradeCheck = Schemas['TradeCheck'];
export type TradeCheckInput = Schemas['TradeCheckInput'];
export type PlayerLine = Schemas['PlayerLine'];
export type WeekFacts = Schemas['WeekFacts'];
export type InjuryDesignation = Schemas['InjuryDesignation'];
export type GamePoints = Schemas['GamePoints'];
export type OrderBasis = Schemas['OrderBasis'];
export type LineupMoves = Schemas['LineupMoves'];
export type HostMoveInput = Schemas['HostMoveInput'];
export type HostMoveChange = Schemas['HostMoveChange'];
export type HostMovePlan = Schemas['HostMovePlan'];
export type HostMoveResult = Schemas['HostMoveResult'];
export type HostBid = Schemas['HostBid'];
export type WaiverMoves = Schemas['WaiverMoves'];
/** A position the waiver route narrows to. */
export type WaiverPosition = NonNullable<
	NonNullable<operations['leagueWaivers']['parameters']['query']>['position']
>;

/** The head every answer carries: the week, the honesty line, the order and its stamps. */
export type AdviceHead = Pick<
	LineupAdvice,
	'week' | 'basis' | 'basis_note' | 'order_basis' | 'refreshed' | 'read_at'
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
	/** The week's matchup as a box score: both sides' starters in their slots and their benches. */
	matchup: (id: string) => client.call<MatchupBox>(path(id, 'matchup')),
	waivers: (id: string, position: WaiverPosition | null = null) =>
		client.call<WaiverAdvice>(path(id, 'waivers', { position })),
	/** The trades, narrowed to those holding one player when given (his board id). */
	trades: (id: string, player: string | null = null) =>
		client.call<TradeAdvice>(path(id, 'trades', { player })),
	/** One trade the member built, on the finder's reckoning; nothing is sent to the host. */
	checkTrade: (id: string, trade: TradeCheckInput) =>
		client.call<TradeCheck>(path(id, 'trades/check'), { method: 'POST', body: trade }),
	/** The move in words with its confirm token; nothing is sent to the host. */
	planMove: (id: string, move: HostMoveInput) =>
		client.call<HostMovePlan>(path(id, 'moves/plan'), { method: 'POST', body: move }),
	/** The planned move, made once with its token. */
	makeMove: (id: string, move: HostMoveInput, confirm: string) =>
		client.call<HostMoveResult>(path(id, 'moves'), { method: 'POST', body: { move, confirm } })
};
