/** ADP for one format: every player its named sources have, in the order drafters take them, beside
 * where our board has him. */
import type { AdpSource, BoardRow, Format } from '#lib/run/schema.ts';
import { links } from '#lib/site/links.ts';
import { withStatuses } from '#lib/run/board-status.ts';
import type { PlayerStatus } from '#lib/run/schema.ts';
import { adp, board, designations } from '../run.ts';
import { boardStatuses, type BoardStatuses } from '../statuses.ts';
import {
	absentFormatPage,
	formatChips,
	formatForRoute,
	formatRoute,
	formatSlugs,
	type AbsentFormatPage,
	type FormatChip
} from './format-route.ts';

export interface AdpPage extends BoardStatuses {
	format: Format;
	formats: FormatChip[];
	sources: AdpSource[];
	/** Board rows with an ADP, earliest first. */
	rows: (BoardRow & { adp: number; status?: PlayerStatus })[];
	/** Players our board ranks that no source has yet. */
	unpriced: number;
}

/** A format's ADP, or the page saying the run lacks the format. */
export type AdpRoute = { kind: 'adp'; page: AdpPage } | { kind: 'absent'; page: AbsentFormatPage };

/** /adp/<format>: ADP for a format the run carries, or the page for one it lacks. */
export async function adpRoute(formatId: string): Promise<AdpRoute> {
	const route = await formatRoute(formatId, (id) => links.adp(id));
	return route.kind === 'run'
		? { kind: 'adp', page: await adpPage(route.format.id) }
		: { kind: 'absent', page: await absentFormatPage(route.format) };
}

export async function adpEntries(): Promise<{ format: string }[]> {
	return (await formatSlugs()).map((format) => ({ format }));
}

export async function adpPage(formatId: string): Promise<AdpPage> {
	const format = await formatForRoute(formatId, (id) => links.adp(id));
	const [loaded, all, formats, capture] = await Promise.all([
		board(format.id),
		adp(),
		formatChips(),
		designations()
	]);
	// The drafters' order stays theirs: a held player keeps his place in it, marked (Lane 63).
	const rows = withStatuses(loaded.rows, capture)
		.flatMap((row) => (row.adp === null ? [] : [{ ...row, adp: row.adp }]))
		.sort((a, b) => a.adp - b.adp || a.ourRank - b.ourRank);
	return {
		format,
		formats,
		sources: all.sources.filter((source) => source.formats.includes(format.id)),
		rows,
		unpriced: loaded.rows.length - rows.length,
		...boardStatuses(rows, capture, format)
	};
}
