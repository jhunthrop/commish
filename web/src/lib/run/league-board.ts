/** The league page's board file (data/league-board/<format>.json), written at build from the run: the
 * format's board with each player's season so far from index.json, the season figures' basis, and
 * (Lane 63) each listed player's injury status with the capture it comes from, the board's order
 * putting a player on a season-long list below the available players at his position. */
import type { CaptureStamp } from '#lib/format/designation.ts';
import type { Format, PlayerStatus, SeasonedRow } from './schema.ts';

export interface LeagueBoardFile {
	format: Format;
	/** The board's rows in its order, each with his games and points a game this season, and his
	 * status when the capture lists him. */
	rows: readonly (SeasonedRow & { status?: PlayerStatus })[];
	/** What the season figures are: the format they are scored in and the last week they reach. */
	season: { scoring: string; through: number };
	/** The injury capture the statuses come from, null when the run carries none. */
	capture: CaptureStamp | null;
}
