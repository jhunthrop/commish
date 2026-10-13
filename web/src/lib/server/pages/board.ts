/** The board's data for one format and one view: All, ranked by points over replacement, or one
 * position, ranked within it and drawn in tiers. */
import { error } from '@sveltejs/kit';
import { positionFromSegment, positionsIn, rangeScale, rowsAt } from '#lib/run/derive.ts';
import type { BoardRow, Format } from '#lib/run/schema.ts';
import type { Position, RangeScale } from '#lib/types/player.ts';
import { board, formatById, manifest } from '../run.ts';

const NOT_FOUND = 404;

export interface FormatChip {
	id: string;
	label: string;
}

export interface BoardPage {
	format: Format;
	formats: FormatChip[];
	/** null is the All view. */
	position: Position | null;
	positions: Position[];
	rows: BoardRow[];
	scale: RangeScale;
	/** How many players the whole board ranks, the population every round tint is counted in. */
	boardSize: number;
}

export async function formatChips(): Promise<FormatChip[]> {
	return (await manifest()).formats.map(({ id, label }) => ({ id, label }));
}

export async function boardPage(formatId: string, segment: string | null): Promise<BoardPage> {
	const format = await formatById(formatId).catch(() => error(NOT_FOUND, 'No such board.'));
	const [loaded, formats] = await Promise.all([board(format.id), formatChips()]);
	const position = segment === null ? null : positionFromSegment(segment);
	if (segment !== null && position === null) error(NOT_FOUND, 'No such position.');
	const rows = position === null ? loaded.rows : rowsAt(loaded.rows, position);
	if (rows.length === 0) error(NOT_FOUND, 'This board ranks nobody at that position.');
	return {
		format,
		formats,
		position,
		positions: positionsIn(loaded.rows),
		rows,
		scale: rangeScale(rows),
		boardSize: loaded.rows.length
	};
}

/** Every board view the build prerenders: each format, its All view and each of its positions. */
export async function boardEntries(): Promise<{ format: string; position: string }[]> {
	const { formats } = await manifest();
	const views = await Promise.all(
		formats.map(async (format) =>
			positionsIn((await board(format.id)).rows).map((position) => ({
				format: format.id,
				position: position.toLowerCase()
			}))
		)
	);
	return views.flat();
}
