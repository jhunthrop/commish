/** Every word the order's screens print that is not a player's, in one place for the copy guard
 * (Lane 66j); in a file of their own with no imports (Lane 66n), so the board's in-season page prints
 * the order's first state without loading the order's code. order.ts re-exports them. */
export const ORDER = {
	/** The column's head, and over it the order it is a place in (the coordinator's ruling 1). */
	rank: '#',
	rankGroup: 'Our rest-of-season order',
	roster: 'Roster',
	restGroup: 'Rest of season',
	/** The rest-of-season points head, under the Rest of season group: "Points", never "Total", a
	 * betting word on the site's list (Lane 66n re-review 2 F2). */
	total: 'Points',
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
	/** The board's in-season page without script, its one line: the order is read in the browser. */
	needsScript: 'Our rest-of-season order needs JavaScript.'
} as const;

/** The kickers' and defenses' week (Lane 66w): the API's position for each, and the board's tab. */
export type WeekPosition = 'K' | 'DEF';

/** The board's tab for the week's position: kickers on K, defenses on DST; null for any other. */
export function weekPositionOf(boardPosition: string | null): WeekPosition | null {
	if (boardPosition === 'K') return 'K';
	if (boardPosition === 'DST') return 'DEF';
	return null;
}

/** Each position's words: its rows in the plural, one of them, and whose a row's figures are. */
export const WEEK_NOUNS: Readonly<
	Record<WeekPosition, { many: string; one: string; whose: string; clubFirst: string }>
> = {
	K: { many: 'kickers', one: 'kicker', whose: 'his', clubFirst: 'his club first' },
	DEF: { many: 'defenses', one: 'defense', whose: 'its', clubFirst: "the defense's club first" }
};

/** The tab's head: "Week 6 kickers" once the week is read, "This week's kickers" before. */
export function weekHeading(position: WeekPosition, week: number | null): string {
	const many = WEEK_NOUNS[position].many;
	return week === null ? `This week's ${many}` : `Week ${String(week)} ${many}`;
}

/** Every other word the week's tab prints, for the copy guard. */
export const WEEK = {
	thisWeek: 'this week',
	reading: "Reading this week's rows",
	needsScript: "This week's rows need JavaScript.",
	unread: 'We could not read this week just now. Try again in a minute.',
	kickedOff: 'Kicked off',
	played: 'Played',
	byeIn: 'Bye in week'
} as const;
