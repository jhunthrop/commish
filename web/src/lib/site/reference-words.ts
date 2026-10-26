/** The reference pages' own words (Lane 199): ADP, Compare, the clubs, a club and the strength of
 * schedule, each said once here so the pages and the apps (through shared/scripts/gen-words.ts) print
 * the same words. A word with "{name}" in it is filled where it is printed. */
import { byeLine } from '#lib/format/bye.ts';

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

/** A club page's section head and empty line while its rows are the rest-of-season order at the
 * order's clock (Lane 223, Lane 220's D2): the head names what the basis beside it names. The web's
 * alone until the apps' lane picks it into their words. */
export const CLUB_ORDER = {
	onOrder: 'On our rest-of-season order',
	nobody: 'Nobody from {city} is in this order'
} as const;

/** A club's meta line, "ARI · Bye week 14" while the bye is ahead of the week the board ranks from,
 * the code alone once it is played (Lane 223, B190), "ARI · bye week not set" where the run names
 * none. */
export function clubMeta(abbr: string, bye: number | null, fromWeek: number | null): string {
	if (bye === null) return `${abbr} · ${CLUB_PAGE.byeWeek} ${CLUB_PAGE.byeNotSet}`;
	const ahead = byeLine(bye, fromWeek);
	return ahead === null ? abbr : `${abbr} · ${ahead}`;
}

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
