/** The Rest of season and Players screens as a box score (Lane 66j): our order's rows in columns, each
 * player's place in our order, his rest-of-season total (the order's key, the big figure) and points a
 * game, his week (the Game cell, Proj, Avg, Last, Opp rank), in a league whose roster holds him and the
 * one move his row admits. Pure functions over the API's answer, so every word the screens print is
 * tested here; every figure is the API's, printed as it comes. */
import { memberZone, weekdayTime, zoneWord } from '#lib/format/clock.ts';
import type { LeagueHost } from '#lib/league/api.ts';
import {
	BOX,
	boxRow,
	factsReadLine,
	positionWord,
	projBasis,
	type BoxRow
} from '#lib/league/box/box.ts';
import { hostWords } from '#lib/league/names.ts';
import { TRADE_FOR_PARAM, WAIVERS_AT_PARAM } from '#lib/league/inseason/tab-list.ts';
import type { OrderAdvice, OrderPosition, OrderRow, RosterMark } from './api.ts';

/** Every word the order's screens print that is not a player's, in one place for the copy guard. */
export const ORDER = {
	/** The column's head, and over it the order it is a place in (the coordinator's ruling 1). */
	rank: '#',
	rankGroup: 'Our rest-of-season order',
	roster: 'Roster',
	restGroup: 'Rest of season',
	total: 'Total',
	perGame: 'A game',
	yours: 'Yours',
	free: 'Free',
	add: 'Add',
	tradeFor: 'Trade for him',
	every: 'All',
	everyone: 'Everyone',
	search: 'Find a player or a club',
	player: 'player',
	moreRows: 'Show more',
	none: 'No player in our order matches.',
	unread: 'We could not read our order just now. Try again in a minute.',
	reading: 'Reading our order'
} as const;

/** The position chips, in the board's order: every position, then each. */
export const ORDER_POSITIONS: readonly OrderPosition[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** A roster chip: every player, the free ones, or the member's own. */
export type RosterView = 'everyone' | 'free' | 'yours';

/** A row as the order's table draws it. */
export interface OrderView {
	key: string;
	box: BoxRow;
	rank: number;
	/** The order's key: his rest-of-season total, null where the order gives none. */
	total: number | null;
	perGame: number | null;
	/** Whose roster holds him in words, with its kind for the chip; null without a league. */
	roster: { kind: RosterMark['kind']; words: string } | null;
	move: OrderRow['move'];
}

/** A roster mark in words: Yours, Free, or the holding team's name. */
export function rosterWords(mark: RosterMark): string {
	if (mark.kind === 'yours') return ORDER.yours;
	if (mark.kind === 'free') return ORDER.free;
	return mark.team ?? '';
}

/** One row's view. Its key is his board id, which every row carries (the order only ranks players
 * our board places). In a position's view the # is his place there, so his pill names his position
 * alone; across positions it names his place at his position too. */
export function orderView(row: OrderRow, zone: string = memberZone(), pillRank = true): OrderView {
	const box = boxRow(row.line, '', zone, pillRank);
	const key = row.line.player.board_id ?? row.line.player.host_id;
	return {
		key,
		box: { ...box, key },
		rank: row.rank,
		total: row.rest_of_season_points,
		perGame: row.line.rest_of_season_per_game,
		roster: row.roster === null ? null : { kind: row.roster.kind, words: rosterWords(row.roster) },
		move: row.move
	};
}

/** The rows a roster chip keeps: a selection of the API's rows, never a figure of the web's. */
export function rowsFor(rows: readonly OrderView[], view: RosterView): OrderView[] {
	if (view === 'everyone') return [...rows];
	return rows.filter((row) => row.roster?.kind === (view === 'free' ? 'free' : 'yours'));
}

/** A move's verb in words. */
export function moveWords(move: NonNullable<OrderRow['move']>): string {
	return move === 'add' ? ORDER.add : ORDER.tradeFor;
}

/** A league screen's page for a league (tabs.ts tabHref, given by the caller). */
export type ScreenHref = (screen: 'waivers' | 'trades', league: string) => string;

/** Where a row's verb goes in the member's league: Add to the Waivers screen at his position, Trade
 * for him to the Trades screen with him chosen; null without a league or a move. */
export function moveHref(
	row: Pick<OrderView, 'key' | 'move' | 'box'>,
	league: string | null,
	screenHref: ScreenHref
): string | null {
	if (league === null || row.move === null) return null;
	if (row.move === 'add') {
		const position = row.box.position === positionWord('DEF') ? 'DEF' : row.box.position;
		return `${screenHref('waivers', league)}?${new URLSearchParams({ [WAIVERS_AT_PARAM]: position }).toString()}`;
	}
	return `${screenHref('trades', league)}?${new URLSearchParams({ [TRADE_FOR_PARAM]: row.key }).toString()}`;
}

/** The order's evidence columns' basis, said once: the Lineup's words, in the scoring the rows are in. */
export function evidenceBasis(league: boolean): string {
	const scoring = league ? "in this league's scoring" : 'in PPR';
	return `${BOX.oppRank} is points allowed to his position, 1st the fewest. ${BOX.avg} and ${BOX.last} are this season's points a game and his last game's, ${scoring}.`;
}

/** Whose rosters the marks are and what a row's verb opens, named once with the member's platform. */
export function rosterBasis(host: LeagueHost, readAt: string, zone: string = memberZone()): string {
	return `${ORDER.roster} is ${hostWords(host)}'s, read ${weekdayTime(readAt, zone)} ${zoneWord(zone)}.`;
}

/** The screen's basis, every number named once, in one paragraph held to five rendered lines at a
 * desk: the order and its two figures, the projection with the evidence, the Game cell's read and,
 * in a league, whose the rosters are and what the league's season points leave out. */
export function orderBasis(
	advice: OrderAdvice,
	league: { host: LeagueHost } | null,
	zone: string = memberZone()
): string {
	const lines = advice.rows.map((row) => row.line);
	const defense = lines.some((line) => line.player.position === 'DEF');
	const said = [
		advice.basis,
		projBasis(advice.projection_read_at, advice.projection_scoring, defense, zone),
		evidenceBasis(league !== null),
		factsReadLine(lines, zone)
	];
	if (league !== null && advice.read_at !== null) {
		said.push(rosterBasis(league.host, advice.read_at, zone), advice.basis_note);
	}
	return said.filter((words): words is string => words !== null && words !== '').join(' ');
}
