/** A game log as the GameLog primitive draws it: every string already worded by the page's loader,
 * so the browser ships no formatting code. */

/** A column: the short head the table prints, and the full words the season line captions it with. */
export interface LogHead {
	short: string;
	full: string;
}

/** A number of the season line and the words under it. */
export interface LineCell {
	value: string;
	caption: string;
}

/** The season line, the log's first row: the games, his points a game, then a total or a rate under
 * each stat head. */
export interface SeasonLine {
	lead: string;
	sub: string;
	points: LineCell;
	/** One per stat head, in order. */
	cells: readonly LineCell[];
}

/** played prints its line, quiet is a week he did not play, bye is his bye. */
export type LogTone = 'played' | 'quiet' | 'bye';

/** A week of the season so far. */
export interface LogRow {
	week: number;
	/** "vs SF", "at PHI", "Bye". */
	opponent: string;
	/** Why a week has no line, under its opponent: "Did not play". Empty otherwise. */
	note: string;
	tone: LogTone;
	/** His points, null for a week with no line. */
	points: string | null;
	/** One per stat head for a played week, null for a week with no line. */
	cells: readonly string[] | null;
}

/** A week still to play, on one compact line. */
export interface AheadRow {
	week: number;
	/** "vs SF", "at PHI", "Bye". */
	opponent: string;
	/** His bye week, drawn on the surface tint. */
	bye: boolean;
	/** His kickoff's day, "Sun Oct 18", empty on his bye. */
	day: string;
}
