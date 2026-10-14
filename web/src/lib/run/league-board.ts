/** The league page's board file (data/league-board/<format>.json), written at build from the run: the
 * format's board with each player's season so far from index.json, and the season figures' basis. */
import type { Format, SeasonedRow } from './schema.ts';

export interface LeagueBoardFile {
	format: Format;
	/** The board's rows, best first, each with his games and points a game this season. */
	rows: readonly SeasonedRow[];
	/** What the season figures are: the format they are scored in and the last week they reach. */
	season: { scoring: string; through: number };
}
