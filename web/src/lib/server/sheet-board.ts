/**
 * Our board as the sheet reads it, from the nightly run the build prerenders (src/lib/server/run.ts).
 * The sheet names formats the way the API does ("ppr", "half_ppr"); the run names a board by its
 * format id and team count ("ppr-12"). A run format reaches the sheet when its id without the
 * team count, hyphens read as underscores, is a sheet format: "ppr-12" is the sheet's "ppr".
 */
import { apiFormatOf } from '#lib/run/format-ids.ts';
import type { DirectoryPlayer } from '#lib/sheet/directory.ts';
import type { LeagueBoardFile } from '#lib/run/league-board.ts';
import type { BoardFormat } from '#lib/sheet/model.ts';
import { withStatuses } from '#lib/run/board-status.ts';
import { withSeasons } from './board-season.ts';
import { board, designations, manifest, seasonReach } from './run.ts';
import { captureStamp } from './statuses.ts';

/** The run's formats the sheet can read, by the sheet's name, each with its run format id. */
async function sheetFormats(): Promise<Map<BoardFormat, string>> {
	const { formats } = await manifest();
	return new Map(
		formats.flatMap((format) => {
			// Boards for the default league size only: the sheet keeps one board per scoring.
			const named = apiFormatOf(format);
			return named === null ? [] : [[named, format.id] as const];
		})
	);
}

/** Every sheet format the run has a board for. */
export async function sheetBoardFormats(): Promise<BoardFormat[]> {
	return [...(await sheetFormats()).keys()];
}

/** What every player's season figures are, as the league page's board file carries it. */
async function seasonBasis(): Promise<LeagueBoardFile['season']> {
	const { scoring, through } = await seasonReach();
	return { scoring, through };
}

/** The run's whole board for a sheet format, its format with it, each player's season so far and his
 * injury status in the board's order (run/board-status.ts), or null when the run has none for it: the
 * league page's board (data/league-board). */
export async function runBoardFor(format: BoardFormat): Promise<LeagueBoardFile | null> {
	const id = (await sheetFormats()).get(format);
	if (id === undefined) return null;
	const [loaded, { formats }, season, capture] = await Promise.all([
		board(id),
		manifest(),
		seasonBasis(),
		designations()
	]);
	const run = formats.find((f) => f.id === id);
	if (!run) return null;
	return {
		format: run,
		rows: await withSeasons(withStatuses(loaded.rows, capture), id),
		season,
		capture: capture === null ? null : captureStamp(capture)
	};
}

/** Our board for a sheet format, best first by our rank, or null when the run has none for it. */
export async function sheetBoard(format: BoardFormat): Promise<readonly DirectoryPlayer[] | null> {
	const id = (await sheetFormats()).get(format);
	if (id === undefined) return null;
	return (await board(id)).rows.map((row) => ({
		id: row.id,
		name: row.name,
		position: row.position,
		team: row.team,
		headshot: row.headshot,
		rank: row.ourRank,
		positionRank: row.positionRank,
		adp: row.adp
	}));
}
