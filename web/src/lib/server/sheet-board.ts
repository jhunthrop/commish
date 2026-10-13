/**
 * Our board as the sheet reads it, from the nightly run the build prerenders (src/lib/server/run.ts).
 * The sheet names formats the way the API does ("ppr", "half_ppr"); the run names a board by its
 * format id and team count ("ppr-12"). A run format reaches the sheet when its id without the
 * team count, hyphens read as underscores, is a sheet format: "ppr-12" is the sheet's "ppr".
 */
import { apiFormatOf } from '#lib/run/catalog.ts';
import type { DirectoryPlayer } from '#lib/sheet/directory.ts';
import type { LeagueBoardFile } from '#lib/run/league-board.ts';
import type { BoardFormat } from '#lib/sheet/model.ts';
import { board, formatById, index, manifest, player } from './run.ts';

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

/** What every player's season figures are: the one format and the one through week every season
 * block in the run shares, checked across all of them. */
async function seasonBasis(): Promise<LeagueBoardFile['season']> {
	const seasons = await Promise.all((await index()).map(async (e) => (await player(e.id)).season));
	const [first] = seasons;
	if (!first) throw new Error('The run indexes no players.');
	const odd = seasons.find((s) => s.format !== first.format || s.through !== first.through);
	if (odd) {
		throw new Error(
			`Season blocks disagree: ${first.format} through week ${String(first.through)} against ${odd.format} through week ${String(odd.through)}.`
		);
	}
	return { scoring: (await formatById(first.format)).label, through: first.through };
}

/** The run's whole board for a sheet format, its format with it and each player's season so far, or
 * null when the run has none for it: the league page's board (data/league-board). */
export async function runBoardFor(format: BoardFormat): Promise<LeagueBoardFile | null> {
	const id = (await sheetFormats()).get(format);
	if (id === undefined) return null;
	const [loaded, { formats }, entries, season] = await Promise.all([
		board(id),
		manifest(),
		index(),
		seasonBasis()
	]);
	const run = formats.find((f) => f.id === id);
	if (!run) return null;
	const seasons = new Map(entries.map((entry) => [entry.id, entry.season] as const));
	const rows = loaded.rows.map((row) => {
		const own = seasons.get(row.id);
		if (!own) throw new Error(`${row.name} is on the ${id} board but not in index.json.`);
		return { ...row, season: own };
	});
	return { format: run, rows, season };
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
