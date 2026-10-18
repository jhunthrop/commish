/** Every word the order's screens print that is not a player's, in one place for the copy guard
 * (Lane 66j); in a file of their own with no imports (Lane 66n), so the board's in-season page prints
 * the order's first state without loading the order's code. order.ts re-exports them. */
export const ORDER = {
	/** The column's head, and over it the order it is a place in (the coordinator's ruling 1). */
	rank: '#',
	rankGroup: 'Our rest-of-season order',
	roster: 'Roster',
	restGroup: 'Rest of season',
	total: 'Total',
	overRepl: 'Over repl.',
	perGame: 'A game',
	yours: 'Yours',
	free: 'Free',
	tradeFor: 'Trade for him',
	every: 'All',
	everyone: 'Everyone',
	search: 'Find a player or a club',
	player: 'player',
	moreRows: 'Show more',
	none: 'No player in our order matches.',
	unread: 'We could not read our order just now. Try again in a minute.',
	reading: 'Reading our order',
	/** The board's in-season page without script: the order is read in the browser. */
	needsScript: 'Our rest-of-season order reads in the browser. Turn on JavaScript to see it.'
} as const;
