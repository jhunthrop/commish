/** The nightly page parts on the system page, drawn from the run the build reads, so every
 * specimen is a real player: the first whose capsule carries pull figures, else the board's first. */
import { rangeScale, rowsAt } from '#lib/run/derive.ts';
import type { BoardRow, IndexEntry, RunRecord } from '#lib/run/schema.ts';
import type { RangeScale } from '#lib/types/player.ts';
import type { ScheduleRow } from '#lib/ui/schedule-grid.ts';
import { board, defaultFormat, player, record } from '../run.ts';
import { schedulePage } from './clubs.ts';
import { formatChips, type FormatChip } from './format-route.ts';
import { playerPage, type PlayerPage } from './player.ts';

/** How many rows a list specimen shows. */
const SPECIMEN_ROWS = 4;
/** How many clubs and weeks the schedule grid specimen shows. */
const SPECIMEN_CLUBS = 3;
const SPECIMEN_WEEKS = 6;

export interface SystemNightly {
	page: PlayerPage;
	rows: BoardRow[];
	hits: IndexEntry[];
	/** The specimen player's own board row, the one the board draws, and his position's range scale. */
	row: BoardRow;
	rowScale: RangeScale;
	formats: FormatChip[];
	schedule: { rows: ScheduleRow[]; weeks: number[] };
	record: RunRecord;
}

async function specimenSlug(rows: readonly BoardRow[]): Promise<string> {
	for (const row of rows) {
		const loaded = await player(row.id);
		if (loaded.capsule && loaded.capsule.pulls.length > 0) return row.slug;
	}
	const [first] = rows;
	if (!first) throw new Error('The default board is empty.');
	return first.slug;
}

export async function systemNightly(): Promise<SystemNightly> {
	const { rows } = await board((await defaultFormat()).id);
	const page = await playerPage(await specimenSlug(rows));
	const row = rows.find((candidate) => candidate.slug === page.slug);
	if (!row) throw new Error(`${page.slug} is not on the default board.`);
	const [formats, grid, kept] = await Promise.all([formatChips(), schedulePage(), record()]);
	const weeks = grid.weeks.slice(0, SPECIMEN_WEEKS);
	return {
		page,
		row,
		rowScale: rangeScale(rowsAt(rows, row.position)),
		formats,
		schedule: {
			weeks,
			rows: grid.rows
				.slice(0, SPECIMEN_CLUBS)
				.map((club) => ({ ...club, cells: club.cells.slice(0, SPECIMEN_WEEKS) }))
		},
		record: kept,
		rows: rows.slice(0, SPECIMEN_ROWS),
		hits: rows.slice(0, SPECIMEN_ROWS).map(({ id, slug, name, team, position, headshot }) => ({
			id,
			slug,
			name,
			team,
			position,
			headshot
		}))
	};
}
