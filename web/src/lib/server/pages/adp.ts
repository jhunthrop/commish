/** ADP for one format: every player its named sources have, in the order drafters take them, beside
 * where our board has him. */
import { error } from '@sveltejs/kit';
import type { AdpSource, BoardRow, Format } from '#lib/run/schema.ts';
import { adp, board, formatById, manifest } from '../run.ts';
import { formatChips, type FormatChip } from './board.ts';

const NOT_FOUND = 404;

export interface AdpPage {
	format: Format;
	formats: FormatChip[];
	sources: AdpSource[];
	/** Board rows with an ADP, earliest first. */
	rows: (BoardRow & { adp: number })[];
	/** Players our board ranks that no source has yet. */
	unpriced: number;
}

export async function adpEntries(): Promise<{ format: string }[]> {
	return (await manifest()).formats.map((format) => ({ format: format.id }));
}

export async function adpPage(formatId: string): Promise<AdpPage> {
	const format = await formatById(formatId).catch(() => error(NOT_FOUND, 'No such format.'));
	const [loaded, all, formats] = await Promise.all([board(format.id), adp(), formatChips()]);
	const rows = loaded.rows
		.flatMap((row) => (row.adp === null ? [] : [{ ...row, adp: row.adp }]))
		.sort((a, b) => a.adp - b.adp || a.ourRank - b.ourRank);
	return {
		format,
		formats,
		sources: all.sources.filter((source) => source.formats.includes(format.id)),
		rows,
		unpriced: loaded.rows.length - rows.length
	};
}
