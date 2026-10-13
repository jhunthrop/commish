/** A game log as the GameLog primitive draws it: every string already worded by the page's loader,
 * so the browser ships no formatting code. */

/** A column: the short head the table prints, and the full words the season line captions it with. */
export interface LogHead {
	short: string;
	full: string;
}

/** The season line, the log's first row: the games, then a total or a rate under each head. */
export interface SeasonLine {
	lead: string;
	sub: string;
	/** One per head, in order: the number and its full words. */
	cells: readonly { value: string; caption: string }[];
}

/** played prints its line, quiet is a week with no line (inactive, upcoming), bye is his bye. */
export type LogTone = 'played' | 'quiet' | 'bye';

export interface LogRow {
	week: number;
	/** "vs SF", "at PHI", "Bye". */
	opponent: string;
	tone: LogTone;
	/** One per head for a played week, null for a week with no line. */
	cells: readonly string[] | null;
	/** A week with no line says why, across the stat columns: "Did not play". */
	note: string;
}
