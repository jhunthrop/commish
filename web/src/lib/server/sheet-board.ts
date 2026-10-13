/**
 * Our board as the sheet reads it, from the nightly run the build prerenders (src/lib/server/run.ts).
 * The sheet names formats the way the API does ("ppr", "half_ppr"); the run names a board by its
 * format id and team count ("ppr-12"). A run format reaches the sheet when its id without the
 * team count, hyphens read as underscores, is a sheet format: "ppr-12" is the sheet's "ppr".
 */
import { DEFAULT_TEAMS } from '#lib/format/draft.ts';
import type { DirectoryPlayer } from '#lib/sheet/directory.ts';
import { parseFormat } from '#lib/sheet/format.ts';
import type { BoardFormat } from '#lib/sheet/model.ts';
import type { Format } from '#lib/run/schema.ts';
import { board, manifest } from './run.ts';

/** The sheet's name for a run format, or null when the sheet has none for it. Boards for the
 * default league size only: the sheet keeps one board per scoring. */
function sheetFormatOf(format: Format): BoardFormat | null {
	const suffix = `-${String(DEFAULT_TEAMS)}`;
	if (format.teams !== DEFAULT_TEAMS || !format.id.endsWith(suffix)) return null;
	return parseFormat(format.id.slice(0, -suffix.length).replaceAll('-', '_'));
}

/** The run's formats the sheet can read, by the sheet's name, each with its run format id. */
async function sheetFormats(): Promise<Map<BoardFormat, string>> {
	const { formats } = await manifest();
	return new Map(
		formats.flatMap((format) => {
			const named = sheetFormatOf(format);
			return named === null ? [] : [[named, format.id] as const];
		})
	);
}

/** Every sheet format the run has a board for. */
export async function sheetBoardFormats(): Promise<BoardFormat[]> {
	return [...(await sheetFormats()).keys()];
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
		positionRank: row.positionRank
	}));
}
