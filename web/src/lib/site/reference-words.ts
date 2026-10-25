/** The reference pages' own words (Lane 199): ADP, Compare, the clubs, a club and the strength of
 * schedule, each said once here so the pages and the apps (through shared/scripts/gen-words.ts) print
 * the same words. A word with "{name}" in it is filled where it is printed. */

/** ADP for one format, and the links to it and from it. */
export const ADP_PAGE = {
	/** The page's heading after the season: "2026 ADP". */
	heading: 'ADP',
	/** The link back to our board in the format. */
	board: 'Board',
	/** Where our board has him, the column's head (board-columns.ts). */
	rank: 'Rk',
	/** The board's link to the strength of schedule page. */
	scheduleLink: 'Schedule strength'
} as const;

/** Compare's words around the table (its call and its first step are built in verdict.ts and
 * compare-words.ts). */
export const COMPARE_PAGE = {
	title: 'Compare',
	firstPlayer: 'First player',
	secondPlayer: 'Second player',
	pickAnother: 'Pick someone else',
	missingTitle: "We couldn't find that player",
	missingLine: 'Nobody here goes by that name.',
	sameTitle: 'Pick two different players',
	addToSheet: 'Add him to your sheet',
	onSheet: '{name} is on your sheet'
} as const;

/** The clubs index and a club's page. */
export const CLUB_PAGE = {
	clubs: 'Clubs',
	/** "ARI · bye week 14", or "not set" where the run names none. */
	byeWeek: 'bye week',
	byeNotSet: 'not set',
	ourRank: 'Our rank',
	/** "12 players on our board". */
	player: 'player',
	onOurBoard: 'on our board',
	/** The section head over the club's rows: "On our PPR board". */
	onBoard: 'On our {format} board',
	nobody: 'Nobody from {city} is on this board',
	kickers: 'Kickers and defense, in draft order',
	week: 'Week',
	opponent: 'Opponent',
	expectedWins: 'Expected wins',
	home: 'vs',
	away: 'at',
	/** The page's one verb: his two best available players side by side. */
	comparePair: 'Compare two of them'
} as const;

/** The strength of schedule page and its grid. */
export const SCHEDULE_PAGE = {
	/** The heading after the season: "2026 schedule strength". */
	heading: 'schedule strength',
	title: 'Schedule strength',
	caption: "Every club's schedule",
	captionHardest: "Every club's schedule, hardest first",
	club: 'Club',
	rank: 'Rank',
	week: 'Wk',
	bye: 'Bye',
	/** The apps' legend under the grid: a shaded cell's words and a set-back cell's. */
	legendHard: '{value} or more',
	legendPlayed: 'Played'
} as const;

/** "On our PPR board", "Nobody from Arizona is on this board": a word with its one name filled. */
export function filled(words: string, name: string): string {
	return words.replace(/\{[a-z]+\}/, name);
}
