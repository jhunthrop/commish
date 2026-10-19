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
	needsScript: "This week's rows need JavaScript."
} as const;
