/** The Rest of season and Players screens as a box score (Lane 66j): our order's rows in columns, each
 * player's place in our order and the key it sorts on as the big figure (the rest-of-season total at
 * a position, points over replacement across positions), his week (the Game cell, Proj, Avg, Last,
 * Opp rank), in a league whose roster holds him and the one move his row admits. Pure functions over
 * the API's answer, so every word the screens print is tested here; every figure is the API's,
 * printed as it comes. */
import { memberZone, weekdayTime, zoneWord } from '#lib/format/clock.ts';
import type { LeagueHost } from '#lib/league/api.ts';
import {
	anyKicked,
	gamePart,
	finalsParts,
	OPP_PART,
	projPart,
	said,
	uncountedPart,
	type BasisPart
} from '#lib/league/box/basis.ts';
import { BOX, boxRow, type BoxRow } from '#lib/league/box/box.ts';
import { lineState } from '#lib/league/box/kickoff.ts';
import { addVerbWords } from '#lib/league/box/waivers.ts';
import { hostWords } from '#lib/league/names.ts';
import { askedQuery } from '#lib/league/box/asked.ts';
import type { OrderAdvice, OrderPosition, OrderRow, RosterMark } from './api.ts';
import { weekHead } from '#lib/format/figure-words.ts';
import { ORDER } from './words.ts';

export { ORDER };

/** The position chips, in the board's order: every position, then each. Kickers and defenses are not
 * on the order (Lane 66m). */
export const ORDER_POSITIONS: readonly OrderPosition[] = ['QB', 'RB', 'WR', 'TE'];

/** A roster chip: every player, the free ones, or the member's own. */
export type RosterView = 'everyone' | 'free' | 'yours';

/** The figure columns of a view: the key first and big, then the others (review 66j H2). */
export type FigureKey = 'por' | 'total' | 'perGame';

/** The view's figure columns from what its rank sorts on: across positions Over repl., Projected and
 * A game; at a position Projected and A game. */
export function figureColumns(rankBy: OrderAdvice['rank_by']): readonly FigureKey[] {
	return rankBy === 'points_over_replacement' ? ['por', 'total', 'perGame'] : ['total', 'perGame'];
}

/** A figure column's head. */
export const FIGURE_HEADS: Readonly<Record<FigureKey, string>> = {
	por: ORDER.overRepl,
	total: ORDER.total,
	perGame: ORDER.perGame
};

/** A row as the order's table draws it. */
export interface OrderView {
	key: string;
	/** His position and the platform's id for him, which the verb's link and rule read. */
	position: string;
	hostId: string;
	box: BoxRow;
	/** The week column (Lane 92, B36): his Pts once his game is final, his Proj before (weekFigure). */
	week: number | null;
	rank: number;
	figures: Readonly<Record<FigureKey, number | null>>;
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
export function orderView(row: OrderRow, zone: string, pillRank: boolean, now: number): OrderView {
	const box = boxRow(row.line, '', zone, pillRank, now);
	const key = row.line.player.board_id ?? row.line.player.host_id;
	return {
		key,
		position: row.line.player.position,
		hostId: row.line.player.host_id,
		box: { ...box, key },
		week: weekFigure(row.line, now),
		rank: row.rank,
		figures: {
			por: row.points_over_replacement,
			total: row.rest_of_season_points,
			perGame: row.line.rest_of_season_per_game
		},
		roster: row.roster === null ? null : { kind: row.roster.kind, words: rosterWords(row.roster) },
		move: row.move
	};
}

/** His week column (Lane 92, B36): once his game is final his points, the platform's where his roster
 * gives them, else our stats' once they land; before it his Proj (as of kickoff once it has kicked
 * off). Null for a final game with no points held yet, never his Proj beside a played game. */
export function weekFigure(line: OrderRow['line'], now: number): number | null {
	const { facts } = line;
	if (lineState(facts, now) !== 'final') return line.week_projection;
	if (facts.points_this_week !== null) return facts.points_this_week;
	return facts.last_games.find((g) => g.week === facts.week)?.points ?? null;
}

/** The week column's key, said once (Lane 92, B36, B50): Pts once final, "--" until they land, Proj
 * before. */
export function weekColumnPart(week: number): string {
	return `${weekHead(week)} is ${BOX.pts} once final, ${BOX.none} until his stats land, ${BOX.proj} before.`;
}

/** The roster filter a chip asks the API for (review 66j H5): null for everyone. */
export function rosterFilter(view: RosterView): 'free' | 'yours' | null {
	return view === 'everyone' ? null : view;
}

/** A move's verb in words (review 66j H6, N3): an add is the Waivers screen's verb by its own rule
 * ("Add on ESPN" where claims open and the platform names him, "Open ESPN waivers" where not); a
 * trade is "Trade for him". */
export function moveWords(
	row: Pick<OrderView, 'move' | 'hostId'>,
	moves: OrderAdvice['moves'],
	host: LeagueHost
): string {
	if (row.move === 'trade') return ORDER.tradeFor;
	return addVerbWords(moves, row.hostId, host);
}

/** A league screen's page for a league (tabs.ts tabHref, given by the caller). */
export type ScreenHref = (screen: 'waivers' | 'trades', league: string) => string;

/** Where a row's verb goes in the member's league, with him chosen by the player card's own query
 * (review 66j N2): the Waivers screen for an add, the Trades screen for a trade; null without a
 * league or a move. */
export function moveHref(
	row: Pick<OrderView, 'key' | 'move' | 'position'>,
	league: string | null,
	screenHref: ScreenHref
): string | null {
	if (league === null || row.move === null) return null;
	const screen = row.move === 'add' ? 'waivers' : 'trades';
	const query = askedQuery(screen, { id: row.key, position: row.position });
	return `${screenHref(screen, league)}?${new URLSearchParams(query).toString()}`;
}

/** Whose rosters the marks are, named once with the member's platform. */
export function rosterBasis(host: LeagueHost, readAt: string, zone: string = memberZone()): string {
	return `${ORDER.roster} is ${hostWords(host)}'s, read ${weekdayTime(readAt, zone)} ${zoneWord(zone)}.`;
}

/** The screen's basis, one paragraph, held to five rendered lines at a desk and eight on a phone
 * (Lane 66q, 66t): the order, the league its points over replacement are for and the figure a game
 * (the API's), this week's projection under its Wk head, Opp rank, in a league the rules Avg and Last
 * leave out with the link to them, then at a desk the Game cell's read and whose the rosters are. The
 * page names no zone elsewhere, so each time says it. */
export function orderBasis(
	advice: OrderAdvice,
	league: { host: LeagueHost } | null,
	zone: string,
	now: number
): BasisPart[] {
	const clock = { zone, zoned: true };
	const lines = advice.rows.map((row) => row.line);
	// The order carries no defense (Lane 66m), so the projection's defense words never apply. The week
	// column is keyed first, then what its Proj is (Lane 92: no week column is called Proj).
	const proj = projPart(
		{
			readAt: advice.projection_read_at,
			scoring: advice.projection_scoring,
			defense: false,
			league: league !== null,
			kicked: anyKicked(lines, now)
		},
		clock
	);
	return [
		...said(advice.basis),
		...said(weekColumnPart(advice.week)),
		...said(proj),
		...said(OPP_PART),
		...(league === null ? [] : uncountedPart(advice)),
		...said(gamePart(lines, clock, now, 'read'), false),
		// Said on the phone too: the board has the room (review finding 6); K/DST keeps it to a desk.
		...finalsParts(lines, now, league?.host ?? null, 'pool', true),
		...(league !== null && advice.read_at !== null
			? said(rosterBasis(league.host, advice.read_at, zone), false)
			: [])
	];
}
