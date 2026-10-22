/** The nightly page parts on the system page, drawn from the run the build reads, so every
 * specimen is a real player: the first whose capsule carries pull figures, else the board's first. */
import { rangeScale, rowsAt } from '#lib/run/derive.ts';
import type { BoardRow, IndexEntry, RunRecord } from '#lib/run/schema.ts';
import type { RangeScale } from '#lib/types/player.ts';
import type { ScheduleRow } from '#lib/ui/schedule-grid.ts';
import { board, defaultFormat, ownPages, record } from '../run.ts';
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
	hits: Omit<IndexEntry, 'season'>[];
	/** The specimen player's own board row, the one the board draws, and his position's range scale. */
	row: BoardRow;
	rowScale: RangeScale;
	formats: FormatChip[];
	schedule: { rows: ScheduleRow[]; weeks: number[] };
	record: RunRecord;
}

/** Tonight's own pages only: a held page (Lane 136) is never the specimen. */
async function specimenSlug(rows: readonly BoardRow[]): Promise<string> {
	const pages = new Map((await ownPages()).map((page) => [page.id, page] as const));
	const own = rows.filter((row) => pages.has(row.id));
	const written = own.find((row) => (pages.get(row.id)?.capsule?.pulls.length ?? 0) > 0);
	const [first] = own;
	if (!first) throw new Error('The default board has no page the reader took.');
	return (written ?? first).slug;
}

export async function systemNightly(now: number): Promise<SystemNightly> {
	const { rows } = await board((await defaultFormat()).id);
	const page = await playerPage(await specimenSlug(rows), now);
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
