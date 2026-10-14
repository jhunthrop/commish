/**
 * This season beside our board. Until the weekly projection round passes its gates, the board stays
 * sorted by the preseason projection, and once the run is past the season's first kickoff every row
 * carries what the season has delivered so far (index.json's games and points a game), under one
 * basis line that says so. Before the first kickoff nothing changes. The run decides, never the
 * reader's clock (seasonUnderway).
 */
import type { BoardRow, Format, IndexSeason } from '#lib/run/schema.ts';
import { index, seasonReach, seasonUnderway, type SeasonReach } from './run.ts';

/** A board row with his games and points a game this season. */
export type SeasonedRow = BoardRow & { season: IndexSeason };

/** A board row as a page prints it: his season figures only once the season is underway. */
export type BoardRowView = BoardRow & { season?: IndexSeason };

export interface BoardSeason {
	rows: BoardRowView[];
	/** The basis line naming the sort and the season figures, or null before the first kickoff. */
	lead: string | null;
}

/** Every row with his season so far from index.json. A board player missing from it fails the build. */
export async function withSeasons(
	rows: readonly BoardRow[],
	format: string
): Promise<SeasonedRow[]> {
	const seasons = new Map((await index()).map((entry) => [entry.id, entry.season] as const));
	return rows.map((row) => {
		const season = seasons.get(row.id);
		if (!season) throw new Error(`${row.name} is on the ${format} board but not in index.json.`);
		return { ...row, season };
	});
}

/** "Sorted by our preseason projection, PPR, full 2026 season. Games and points a game are this
 * season's, through week 5." The season figures name their scoring only when it is not the board's. */
export function seasonLead(format: Format, reach: SeasonReach): string {
	const sort = `Sorted by our preseason projection, ${format.basis[0] ?? format.label}.`;
	const scoring = reach.scoring === format.label ? '' : `, ${reach.scoring}`;
	const through = reach.through === 0 ? '' : `, through week ${String(reach.through)}`;
	return `${sort} Games and points a game are this season's${scoring}${through}.`;
}

/** A board's rows and basis line as its page prints them. */
export async function boardSeason(format: Format, rows: BoardRow[]): Promise<BoardSeason> {
	if (!(await seasonUnderway())) return { rows, lead: null };
	const [seasoned, reach] = await Promise.all([withSeasons(rows, format.id), seasonReach()]);
	return { rows: seasoned, lead: seasonLead(format, reach) };
}
