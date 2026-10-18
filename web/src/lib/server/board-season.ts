/**
 * This season beside our board. Until the switch week the board stays ranked by points over
 * replacement from the preseason projection; from it the run ranks the rest of the season and the
 * line says so (`restLead`). Once the run is past the
 * season's first kickoff every row carries what the season has delivered so far (index.json's games
 * and points a game), under one basis line that says so. Before the first kickoff nothing changes. The run decides, never the
 * reader's clock (seasonUnderway).
 */
import { midSentence } from '#lib/format/sentence.ts';
import { figuresLine, restLead } from '#lib/run/rest-words.ts';
import type { BoardRow, BoardRowView, Format, SeasonedRow } from '#lib/run/schema.ts';
import { index, manifest, seasonReach, seasonUnderway, type SeasonReach } from './run.ts';

export interface BoardSeason {
	rows: BoardRowView[];
	/** The basis line naming the sort and the season figures, or null before the first kickoff. */
	lead: string | null;
	/** How far the season's figures reach, null before the first kickoff: a page's basis names it. */
	reach: SeasonReach | null;
}

/** Every row with his season so far from index.json. A board player missing from it fails the build. */
export async function withSeasons<R extends BoardRow>(
	rows: readonly R[],
	format: string
): Promise<(R & SeasonedRow)[]> {
	const seasons = new Map((await index()).map((entry) => [entry.id, entry.season] as const));
	return rows.map((row) => {
		const season = seasons.get(row.id);
		if (!season) throw new Error(`${row.name} is on the ${format} board but not in index.json.`);
		return { ...row, season };
	});
}

/** "Ranked by points over replacement, our preseason PPR projection for the full 2026 season. Games
 * and points a game are this season's, through week 5." The order is the board's own (over
 * replacement), so the line names it before the projection it comes from. The run scores every
 * season block in one format, so on a board of another scoring the figures name theirs: "this
 * season's, scored in PPR, through week 5". */
export function seasonLead(format: Format, reach: SeasonReach, season: number): string {
	const rest = restLead(format, reach, season);
	if (rest !== null) return rest;
	const sort = `Ranked by points over replacement, our preseason ${midSentence(format.label)} projection for the full ${String(season)} season.`;
	return `${sort} ${figuresLine(format, reach)}`;
}

/** A board's rows and basis line as its page prints them. */
export async function boardSeason(format: Format, rows: BoardRowView[]): Promise<BoardSeason> {
	if (!(await seasonUnderway())) return { rows, lead: null, reach: null };
	const [seasoned, reach, run] = await Promise.all([
		withSeasons(rows, format.id),
		seasonReach(),
		manifest()
	]);
	return { rows: seasoned, lead: seasonLead(format, reach, run.season), reach };
}
