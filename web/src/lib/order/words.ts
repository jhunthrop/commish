/** Every word the order's screens print that is not a player's, in one place for the copy guard
 * (Lane 66j); in a file of their own with no imports (Lane 66n), so the board's in-season page prints
 * the order's first state without loading the order's code. order.ts re-exports them. The figures'
 * heads are the site's one word for each (format/figure-words.ts, itself import-free). */
import { FIGURE } from '#lib/format/figure-words.ts';

export const ORDER = {
	/** The column's head, and over it the order it is a place in (the coordinator's ruling 1). */
	rank: '#',
	rankGroup: 'Our rest-of-season order',
	roster: 'Roster',
	restGroup: 'Rest of season',
	/** The rest-of-season total's head, under the Rest of season group: Projected, as every screen
	 * heads the projection's total (the ruling on the sweep's X2); never "Total", a betting word. */
	total: FIGURE.projected,
	overRepl: 'Over repl.',
	perGame: FIGURE.perGame,
	yours: 'Yours',
	free: 'Free',
	tradeFor: 'Trade for him',
	/** A free agent on a list with no return week, whom Waivers neither lists nor stashes: his verb
	 * cell says why he has none (Lane 128), after the list's word ("On IR"). */
	noReturn: 'no return date',
	/** The same, his return falling after the regular season (Waivers' stash_late). */
	backLate: 'back after the regular season',
	every: 'All',
	everyone: 'Everyone',
	search: 'Find a player or a club',
	moreRows: 'Show more',
	none: 'No player in our order matches.',
	unread: 'We could not read our order just now. Try again in a minute.',
	reading: 'Reading our order',
	/** The board's in-season page without script, its one line: the order is read in the browser. */
	needsScript: 'Our rest-of-season order needs JavaScript.'
} as const;

/** The kickers' and defenses' week (Lane 66w): the words the board prints before its tab loads,
 * for the copy guard. Its head is week-head.ts's, the rest of the tab's words week.ts's. */
export const WEEK = {
	reading: "Reading this week's rows",
	needsScript: "This week's rows need JavaScript.",
	/** The byes' section, before its week (byeHead). */
	byeIn: 'Bye in week'
} as const;

/** The Players page's sentence under its head (Lane 164): before the season the page's purpose; in
 * season on our order's chips, whose order it is with the week's game beside each player, the week
 * the table's own (the board's week the order was read for); on the K and D/ST chips none, their
 * own basis line says the rest (one basis per screen). Undefined draws no sentence. */
export function playersLead(
	inSeason: boolean,
	onWeekChip: boolean,
	boardWeek: number | null
): string | undefined {
	if (!inSeason) return PAGE_PURPOSE.players;
	return onWeekChip || boardWeek === null ? undefined : PAGE_PURPOSE.rankings(boardWeek);
}

/** The byes' section head, "Bye in week 7": the week's box score and the Players page's week
 * rankings say it in one word (Lane 163, D06). */
export function byeHead(week: number): string {
	return `${WEEK.byeIn} ${String(week)}`;
}

/** Each in-season page's purpose, one sentence under its head (Lane 104, B40): Players is every
 * player our order covers and this week's kickers and defenses, never said to be in it (Lane 155),
 * Rest of season the same order in your league's view. */
export const PAGE_PURPOSE = {
	players:
		"Every QB, RB, WR and TE in our order, and this week's kickers and defenses, to look up and to compare.",
	/** The same page in season, "Rankings" (Lane 164, D11): whose order it is, and that the week's
	 * game sits beside each player, the week said here and never in the page's name. */
	rankings: (week: number) =>
		`Our rest-of-season order, with week ${String(week)}'s game beside each player`,
	rest: "Our order in your league's view: who holds each player, the free agents, and this week's kickers and defenses."
} as const;
