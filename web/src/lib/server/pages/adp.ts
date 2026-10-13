/** ADP for one format: every player its named sources have, in the order drafters take them, beside
 * where our board has him. */
import type { AdpSource, BoardRow, Format } from '#lib/run/schema.ts';
import { links } from '#lib/site/links.ts';
import { adp, board } from '../run.ts';
import { formatForRoute, formatSlugs } from './format-route.ts';
import { formatChips, type FormatChip } from './board.ts';

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
	return (await formatSlugs()).map((format) => ({ format }));
}

export async function adpPage(formatId: string): Promise<AdpPage> {
	const format = await formatForRoute(formatId, (id) => links.adp(id));
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
