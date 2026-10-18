/** ADP for one format: every player its named sources have, in the order drafters take them, beside
 * where our board has him. */
import { carriesGap } from '#lib/format/gap.ts';
import { adpDrafts } from '#lib/run/adp-drafts.ts';
import { boardBasis, type BasisPart } from '#lib/run/board-basis.ts';
import { rowFraming } from '#lib/run/row-framing.ts';
import type {
	AdpSource,
	BoardRow,
	Format,
	IndexSeason,
	MarketRowView,
	PlayerStatus
} from '#lib/run/schema.ts';
import { links } from '#lib/site/links.ts';
import { withFace } from '#lib/site/market.ts';
import { withStatuses } from '#lib/run/board-status.ts';
import { boardSeason } from '../board-season.ts';
import { adp, board, clubByes, designations, manifest } from '../run.ts';
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
	/** Board rows with an ADP, earliest first: the ranked rows (each with his season so far once it is
	 * underway) and the kickers and defenses alike. */
	rows: ((BoardRow | MarketRowView) & {
		adp: number;
		status?: PlayerStatus;
		season?: IndexSeason;
	})[];
	/** The page's basis, said once under the title (Lane 66n). */
	basis: BasisPart[];
	/** The season is underway: the ranked rows carry this season's GP and A game. */
	/** The screen shows the Gap: the board compares drafters with our rank and the run carries the
	 * figure on one of its rows (re-review N1). */
	gap: boolean;
	underway: boolean;
	/** Each club's bye week, for the Bye column and the sort by it. */
	byes: Record<string, number | null>;
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
	const [loaded, all, formats, capture, byes, run] = await Promise.all([
		board(format.id),
		adp(),
		formatChips(),
		designations(),
		clubByes(),
		manifest()
	]);
	const { rows: ranked, reach } = await boardSeason(format, withStatuses(loaded.rows, capture));
	// The drafters' order stays theirs: a held player keeps his place in it, marked (Lane 63).
	const rows = [...ranked, ...withStatuses(loaded.market.map(withFace), capture)]
		.flatMap((row) => (row.adp === null ? [] : [{ ...row, adp: row.adp }]))
		.sort((a, b) => a.adp - b.adp || a.ourRank - b.ourRank);
	const showsGap = rowFraming(format).compare && carriesGap(rows);
	const sources = all.sources.filter((source) => source.formats.includes(format.id));
	return {
		format,
		formats,
		sources,
		rows,
		basis: boardBasis({
			format,
			season: run.season,
			order: 'adp',
			adpBasis: adpDrafts(all.sources, format.id),
			gap: showsGap,
			reach,
			noAdp: loaded.rows.filter((row) => row.adp === null).length
		}),
		gap: showsGap,
		underway: reach !== null,
		byes,
		...boardStatuses(rows, capture, format)
	};
}
