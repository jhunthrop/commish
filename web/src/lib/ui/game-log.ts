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

/** The season line, the box's totals row at its foot: the games and his points a game, his points
 * for the season, then a total or a rate under each stat head. */
export interface SeasonLine {
	lead: string;
	/** "3 games, 25.9 a game". */
	sub: string;
	/** His points for the season. */
	total: string;
	points: LineCell;
	/** One per stat head, in order. */
	cells: readonly LineCell[];
}

/** An earlier season as the box's collapsed row: the season, its games and points a game, its points,
 * then a total or a rate under each stat head. */
export interface PriorRow {
	season: number;
	/** "16 games, 23.4 a game". */
	sub: string;
	total: string;
	cells: readonly string[];
}

/** The week ahead as the box's accent row, read after the first paint: the opponent, the kickoff,
 * this week's projection and the game's facts in the box's cell form. */
export interface LogNext {
	week: number;
	/** "vs ARI". */
	opponent: string;
	/** "Sun 3:05 pm". */
	when: string;
	/** "21.8", or "--" without one. */
	proj: string;
	/** "32.5 to 20", null without the figures. */
	expected: string | null;
	weather: { glyph: 'wind' | 'indoors' | 'roof' | 'abroad' | 'outdoors'; words: string } | null;
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
