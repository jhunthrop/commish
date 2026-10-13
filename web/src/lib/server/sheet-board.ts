/**
 * STAND-IN until the nightly run lands in web/. The sheet reads our board through this one
 * function at build. Today it reads the real 2026 PPR board the approved mocks were built from
 * (docs/design/mocks/2026-10-12-commish/data/board-ppr.csv), the same data Lane 5's stand-in run
 * is converted from. When the run loader is on main, the body becomes a map over its
 * `board(format)` rows and SHEET_BOARD_FORMATS becomes the manifest's formats. Nothing else in the
 * sheet changes.
 */
import boardCsv from '../../../../docs/design/mocks/2026-10-12-commish/data/board-ppr.csv?raw';
import { parsePosition, type BoardFormat } from '#lib/sheet/model.ts';
import type { DirectoryPlayer } from '#lib/sheet/directory.ts';

/** The formats we have a board for. */
export const SHEET_BOARD_FORMATS: readonly BoardFormat[] = ['ppr'];

const COLUMNS = ['rank', 'position_rank', 'name', 'position', 'nfl_team', 'headshot_url', 'player_id'];

function rowsOf(csv: string): readonly Record<string, string>[] {
	const [header = '', ...lines] = csv.trim().split(/\r?\n/);
	const names = header.split(',');
	const missing = COLUMNS.filter((column) => !names.includes(column));
	if (missing.length > 0) throw new Error(`The board CSV has no ${missing.join(', ')} column.`);
	return lines.map((line) => {
		const cells = line.split(',');
		return Object.fromEntries(names.map((name, i) => [name, cells[i] ?? '']));
	});
}

function toPlayer(row: Readonly<Record<string, string>>): DirectoryPlayer {
	const position = parsePosition(row.position ?? '');
	const rank = Number(row.rank);
	const positionRank = Number(row.position_rank);
	if (position === null || !Number.isInteger(rank) || !Number.isInteger(positionRank)) {
		throw new Error(`The board CSV row for ${row.name ?? 'a player'} does not read.`);
	}
	return {
		id: row.player_id ?? '',
		name: row.name ?? '',
		position,
		team: row.nfl_team === '' ? null : (row.nfl_team ?? null),
		headshot: row.headshot_url === '' ? null : (row.headshot_url ?? null),
		rank,
		positionRank
	};
}

/** Our board for a format, best first, or null when we have none for it. */
export function sheetBoard(format: BoardFormat): readonly DirectoryPlayer[] | null {
	if (!SHEET_BOARD_FORMATS.includes(format)) return null;
	return rowsOf(boardCsv)
		.map(toPlayer)
		.toSorted((a, b) => a.rank - b.rank);
}
