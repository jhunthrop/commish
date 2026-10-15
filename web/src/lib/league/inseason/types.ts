/** The three in-season answers (spec 2026-10-15-in-season-tools-design §7), hand-written from the
 * spec's shapes with its field names and types verbatim, until the API lands, then the generated
 * types replace this file. Every number carries its basis once at the head of an answer, and every
 * stamp is a date-time. */
import type { LeaguePlayer } from '../api.ts';

/** A designation as the injury report states it, with when it was read. */
export interface Designation {
	status: 'questionable' | 'doubtful' | 'out' | 'injured_reserve' | 'suspended' | 'pup' | 'nfi';
	/** Format: date-time. */
	as_of: string;
}

export type DesignationStatus = Designation['status'];

/** One completed game under the league's scoring. */
export interface LastGame {
	week: number;
	points: number;
}

/** What the opponent's defense has allowed to his position this season, under the league's scoring. */
export interface AllowedToPosition {
	points_a_game: number;
	/** 1 is the most allowed. */
	rank: number;
	of: number;
	position: string;
}

/** This week's facts for one player, shared by every player row on the three screens. */
export interface WeekFacts {
	week: number;
	/** "BUF"; null on bye. */
	opponent: string | null;
	home: boolean | null;
	/** Format: date-time. */
	kickoff: string | null;
	bye: boolean;
	designation: Designation | null;
	/** His game this week is final. */
	played: boolean;
	/** The host's score so far, from the matchup when he is a starter. */
	points_this_week: number | null;
	/** Up to three completed games, under the league's scoring. */
	last_games: LastGame[];
	allowed_to_position: AllowedToPosition | null;
}

export interface PlayerLine {
	player: LeaguePlayer;
	/** Rest-of-season from week 7, preseason before; null when unranked. */
	position_rank: number | null;
	points_over_replacement: number | null;
	facts: WeekFacts;
}

export type OrderBasis = 'preseason' | 'rest_of_season';

/** The head every answer carries: the week, the honesty line, what the order is and its stamps. */
export interface AdviceHead {
	week: number;
	/** The honesty line, said above the rows. */
	basis: string;
	order_basis: OrderBasis;
	/** Format: date-time. The run the order came from. */
	refreshed: string;
	/** Format: date-time. The league's last host read. */
	read_at: string;
}

export interface LineupSlot {
	slot: string;
	ours: PlayerLine;
	host: PlayerLine | null;
	changed: boolean;
	sentence: string | null;
}

export interface LineupAdvice extends AdviceHead {
	/** True when no change. */
	set: boolean;
	slots: LineupSlot[];
	bench: PlayerLine[];
	/** The host's lineup page. */
	host_lineup_url: string;
}

export interface WaiverRow {
	add: PlayerLine;
	drop: PlayerLine | null;
	/** Points over replacement a week to the lineup. */
	gain: number;
	/** He starts for you this week. */
	starts: boolean;
	sentence: string;
}

export interface WaiverAdvice extends AdviceHead {
	best: WaiverRow | null;
	/** Positive gain first, then the rest under a rule. */
	rows: WaiverRow[];
	host_waivers_url: string;
}

export interface TradeRow {
	give: PlayerLine[];
	get: PlayerLine[];
	my_gain: number;
	their_gain: number;
	close_for_them: boolean;
}

/** The spec names a team's record without a shape. Read here as the standings strip reads one; the
 * generated type settles it. */
export interface TradeRecord {
	wins: number;
	losses: number;
	ties: number;
}

export interface TradeTeam {
	roster_id: number;
	name: string;
	owner: string;
	record: TradeRecord;
	trades: TradeRow[];
}

export interface TradeAdvice extends AdviceHead {
	teams: TradeTeam[];
	host_trades_url: string;
}
