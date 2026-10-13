/** The board's data for one format and one view: All, ranked by points over replacement, or one
 * position, ranked within it and drawn in tiers. */
import { error } from '@sveltejs/kit';
import { positionFromSegment, positionsIn, rangeScale, rowsAt } from '#lib/run/derive.ts';
import type { BoardRow, Format } from '#lib/run/schema.ts';
import type { Position, RangeScale } from '#lib/types/player.ts';
import { links } from '#lib/site/links.ts';
import { windowLabel } from '#lib/format/date.ts';
import { adp, board, manifest } from '../run.ts';
import { formatForRoute, formatSlugs } from './format-route.ts';

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
	/** The drafts behind this format's ADP and their window, from the run: "PPR drafts, Sep 5 to Sep 9". */
	adpBasis: string[];
}

export async function formatChips(): Promise<FormatChip[]> {
	return (await manifest()).formats.map(({ id, label }) => ({ id, label }));
}

export async function boardPage(formatId: string, segment: string | null): Promise<BoardPage> {
	const position = segment === null ? null : positionFromSegment(segment);
	if (segment !== null && position === null) error(NOT_FOUND, 'No such position.');
	const format = await formatForRoute(formatId, (id) => links.board(id, position));
	const [loaded, formats, sources] = await Promise.all([board(format.id), formatChips(), adp()]);
	const rows = position === null ? loaded.rows : rowsAt(loaded.rows, position);
	if (rows.length === 0) error(NOT_FOUND, 'This board ranks nobody at that position.');
	return {
		format,
		formats,
		position,
		positions: positionsIn(loaded.rows),
		rows,
		scale: rangeScale(rows),
		boardSize: loaded.rows.length,
		adpBasis: sources.sources
			.filter((source) => source.formats.includes(format.id))
			.map((source) => `${source.drafts}, ${windowLabel(source.window)}`)
	};
}

/** Every format slug a board route answers: canonical ids, and short slugs that redirect. */
export async function boardFormatEntries(): Promise<{ format: string }[]> {
	return (await formatSlugs()).map((format) => ({ format }));
}

/** Every position view the build prerenders: each format slug, each position its board ranks. */
export async function boardEntries(): Promise<{ format: string; position: string }[]> {
	const [{ formats }, slugs] = await Promise.all([manifest(), formatSlugs()]);
	const positions = new Set<string>();
	for (const format of formats) {
		for (const position of positionsIn((await board(format.id)).rows)) {
			positions.add(position.toLowerCase());
		}
	}
	return slugs.flatMap((format) => [...positions].map((position) => ({ format, position })));
}
