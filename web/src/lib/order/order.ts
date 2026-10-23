/** The Rest of season and Players screens as a box score (Lane 66j): our order's rows in columns, each
 * player's place in our order, his projected rest-of-season points as the big figure (Lane 139, C20, as
 * the front board draws them) with the key it sorts on beside it across positions (points over
 * replacement), his week (the Game cell, Proj, Avg, Last,
 * Opp rank), in a league whose roster holds him and the one move his row admits. Pure functions over
 * the API's answer, so every word the screens print is tested here; every figure is the API's,
 * printed as it comes. */
import { kickoffAt, memberZone, weekdayTime, zoneWord } from '#lib/format/clock.ts';
import { onListWords } from '#lib/format/designation.ts';
import type { LeagueHost } from '#lib/league/api.ts';
import {
	anyKicked,
	deskOrPhone,
	gamePart,
	finalsParts,
	OPP_PART,
	OPP_PHONE,
	projPart,
	said,
	uncountedPart,
	weekProjPart,
	type BasisPart,
	type ProjFacts
} from '#lib/league/box/basis.ts';
import { BOX, boxRow, expectedScoreWords, onList, type BoxRow } from '#lib/league/box/box.ts';
import { lineState, toPlay } from '#lib/league/box/kickoff.ts';
import { addVerbWords } from '#lib/league/box/waivers.ts';
import { hostWords } from '#lib/league/names.ts';
import { askedHref } from '#lib/league/box/asked.ts';
import type { OrderAdvice, OrderPosition, OrderRow, RosterMark } from './api.ts';
import { weekHead } from '#lib/format/figure-words.ts';
import type { WeekPosition } from './week-head.ts';
import { ORDER, byeHead } from './words.ts';

export { ORDER };

/** The position chips, in the board's order: every position, then each. Kickers and defenses are not
 * on the order (Lane 66m). */
export const ORDER_POSITIONS: readonly OrderPosition[] = ['QB', 'RB', 'WR', 'TE'];

/** The Players page's position chips (Lane 155): our order's four, then this week's kickers and
 * defenses, which the week's box score draws in the published projection's order (we rank neither). */
export const PLAYERS_CHIPS: readonly PlayersChip[] = [...ORDER_POSITIONS, 'K', 'DEF'];

/** A Players chip: one of our order's positions, or the week's kickers or defenses. */
export type PlayersChip = OrderPosition | WeekPosition;

/** Whether a chip draws the week's box score (K or DEF) rather than our order. */
export function isWeekChip(position: PlayersChip): position is WeekPosition {
	return position === 'K' || position === 'DEF';
}

/** The week's position a chip draws (K or DEF), null for our order's and for All. */
export function weekChip(position: PlayersChip | null): WeekPosition | null {
	return position !== null && isWeekChip(position) ? position : null;
}

/** A roster chip: every player, the free ones, or the member's own. */
export type RosterView = 'everyone' | 'free' | 'yours';

/** The figure columns of a view: his projected points first and big, then the others (Lane 139, C20). */
export type FigureKey = 'por' | 'total' | 'perGame';

/** The view's figure columns from what its rank sorts on: Projected always first, the row's biggest
 * figure as on the front board (Lane 139, C20, B46); across positions Over repl., the key the # sorts
 * on, beside it, then A game. */
export function figureColumns(rankBy: OrderAdvice['rank_by']): readonly FigureKey[] {
	return rankBy === 'points_over_replacement' ? ['total', 'por', 'perGame'] : ['total', 'perGame'];
}

/** The column the # sorts on, marked in its head (Lane 139 fix round 1, MEDIUM-3; the 2026-10-19
 * ruling: a sorted column draws its key): Over repl. across positions, Projected at one. */
export function sortedFigure(rankBy: OrderAdvice['rank_by']): FigureKey {
	return rankBy === 'points_over_replacement' ? 'por' : 'total';
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
	/** The # cell: his place, the list's short form ("IR") for a player on a season-long list, or
	 * nothing on the week's rankings for a player on bye (Lane 163, D06). */
	place: string;
	/** On the week's rankings, an available player whose club is on bye this week: his row sits in
	 * the byes' section after the players who play (orderSections). */
	bye: boolean;
	figures: Readonly<Record<FigureKey, number | null>>;
	/** Whose roster holds him in words, with its kind for the chip; null without a league. */
	roster: { kind: RosterMark['kind']; words: string } | null;
	move: OrderRow['move'];
	/** In the verb's place, a free agent on a list the API gives no move ("On IR, no return date",
	 * Lane 128); null otherwise. */
	held: string | null;
}

/** The verb cell's words for a free agent the order gives no move (Lane 128): Waivers neither lists
 * nor stashes him, so the cell says why, his list or his week's Out, then that no return date is
 * read, or, with one the API left the add off, that it falls after the regular season (Waivers'
 * stash_late). Null for anyone the order moves or who is not free. */
export function heldMoveWords(
	row: Pick<OrderRow, 'move' | 'roster' | 'line'>,
	status: BoxRow['status']
): string | null {
	if (row.move !== null || row.roster?.kind !== 'free' || !status?.sits) return null;
	const said = onList(status) ? onListWords(status.rank ?? '') : status.mark;
	const back = row.line.facts.designation?.return_week ?? null;
	return `${said}, ${back === null ? ORDER.noReturn : ORDER.backLate}`;
}

/** A roster mark in words: Yours, Free, or the holding team's name. */
export function rosterWords(mark: RosterMark): string {
	if (mark.kind === 'yours') return ORDER.yours;
	if (mark.kind === 'free') return ORDER.free;
	return mark.team ?? '';
}

/** One row's view. Its key is his board id, which every row carries (the order only ranks players
 * our board places). In a position's view the # is his place there, so his pill names his position
 * alone; across positions it names his place at his position too. On the week's rankings
 * (byesApart, the Players page, Lane 163 D06) a player on bye draws no place. */
export function orderView(
	row: OrderRow,
	zone: string,
	pillRank: boolean,
	now: number,
	byesApart = false
): OrderView {
	const box = boxRow(row.line, '', zone, pillRank, now);
	const key = row.line.player.board_id ?? row.line.player.host_id;
	const listed = onList(box.status);
	const bye = byesApart && row.line.facts.bye && !listed;
	return {
		key,
		position: row.line.player.position,
		hostId: row.line.player.host_id,
		box: { ...box, key, ...orderGame(box, row.line, zone, now) },
		week: listed ? null : weekFigure(row.line, now),
		rank: row.rank,
		// A player on a season-long list sits after every available one with no number (Lane 128 fix
		// round 1): his # cell reads the list's short form. A bye on the week's rankings has none.
		place: listed ? (box.status?.rank ?? '') : bye ? '' : String(row.rank),
		bye,
		figures: {
			por: row.points_over_replacement,
			total: row.rest_of_season_points,
			perGame: row.line.rest_of_season_per_game
		},
		roster: row.roster === null ? null : { kind: row.roster.kind, words: rosterWords(row.roster) },
		move: row.move,
		held: heldMoveWords(row, box.status)
	};
}

/** A run of the order's rows under one head: the players who play first with none, then on the
 * week's rankings the byes under "Bye in week 7", as the week's box score draws its byes (Lane 163,
 * D06). A section with no rows is not drawn. */
export interface OrderSection {
	key: 'playing' | 'bye';
	head: string | null;
	rows: OrderView[];
}

/** The rows in their sections, in the API's order (byes=last puts the byes last). */
export function orderSections(views: readonly OrderView[], week: number): OrderSection[] {
	const sections: OrderSection[] = [
		{ key: 'playing', head: null, rows: views.filter((v) => !v.bye) },
		{ key: 'bye', head: byeHead(week), rows: views.filter((v) => v.bye) }
	];
	return sections.filter((section) => section.rows.length > 0);
}

/** His Game cell on the order (Lane 139, C07, C11): a kickoff still to come with its zone, so it never
 * reads as another zone's, and the expected score labelled with both clubs, so it never reads as a
 * final. */
function orderGame(
	box: BoxRow,
	line: OrderRow['line'],
	zone: string,
	now: number
): Pick<BoxRow, 'game' | 'expected'> {
	const { facts } = line;
	const { game } = box;
	const ahead = typeof game === 'object' && game !== null && toPlay(facts, now);
	return {
		game:
			ahead && facts.kickoff !== null ? { ...game, when: kickoffAt(facts.kickoff, zone) } : game,
		expected: box.expected === null ? null : expectedScoreWords(facts, line.player.team)
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
	return askedHref(screenHref(screen, league), screen, { id: row.key, position: row.position });
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
	const projFacts: ProjFacts = {
		readAt: advice.projection_read_at,
		scoring: advice.projection_scoring,
		defense: false,
		league: league !== null,
		kicked: anyKicked(lines, now)
	};
	const week = `${weekColumnPart(advice.week)} ${projPart(projFacts, clock)}`;
	return [
		...said(advice.basis),
		// A league's phone says the week column and its Proj in one sentence, the scoring left to the
		// page's head ("Your league scores PPR."), so the order keeps to eight lines (Lane 115, B92).
		...(league === null
			? said(week)
			: deskOrPhone(week, weekProjPart(weekHead(advice.week), projFacts, clock))),
		...deskOrPhone(OPP_PART, OPP_PHONE),
		...(league === null ? [] : uncountedPart(advice, lines)),
		...said(gamePart(lines, clock, now, 'read'), false),
		// Said on the phone too: the board has the room (review finding 6); K/DST keeps it to a desk.
		...finalsParts(lines, now, league?.host ?? null, 'pool', true),
		...(league !== null && advice.read_at !== null
			? said(rosterBasis(league.host, advice.read_at, zone), false)
			: [])
	];
}
