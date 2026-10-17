/** The board's data for one format and one view: All, ranked by points over replacement, or one
 * position, ranked within it and drawn in tiers. */
import { error } from '@sveltejs/kit';
import {
	carriesRange,
	positionFromSegment,
	positionsIn,
	rangeScale,
	rowsAt
} from '#lib/run/derive.ts';
import { boardBasisTerms, type BasisTerm } from '#lib/run/board-basis.ts';
import { rowFraming, type RowFraming } from '#lib/run/row-framing.ts';
import type { BoardRowView, Format, MarketRowView } from '#lib/run/schema.ts';
import { isMarketPosition, marketAt } from '#lib/run/market.ts';
import { marketBasis, withFace } from '#lib/site/market.ts';
import type { Position, RangeScale } from '#lib/types/player.ts';
import { scoringBasis } from '#lib/run/catalog.ts';
import { links } from '#lib/site/links.ts';
import { windowLabel } from '#lib/format/date.ts';
import { withStatuses } from '#lib/run/board-status.ts';
import type { CaptureStamp } from '#lib/format/designation.ts';
import type { BoardStatusWords } from '#lib/run/status-view.ts';
import { boardStatuses } from '../statuses.ts';
import { boardSeason } from '../board-season.ts';
import { adp, board, designations, manifest } from '../run.ts';
import {
	absentFormatPage,
	formatChips,
	formatForRoute,
	formatRoute,
	formatSlugs,
	runFormatSlugs,
	type AbsentFormatPage,
	type FormatChip
} from './format-route.ts';

const NOT_FOUND = 404;

export interface BoardPage {
	format: Format;
	formats: FormatChip[];
	/** null is the All view. */
	position: Position | null;
	positions: Position[];
	/** Each with his season figures once the season is underway. None on a kicker's or a defense's view. */
	rows: BoardRowView[];
	/** A kicker's or a defense's view: the position in draft order, each with his status. */
	market: MarketRowView[];
	/** That view's basis, said once in place of the format's: the order and its drafts. */
	marketBasis: string | null;
	/** The basis line once the season is underway, which the page prints in place of the format's. */
	seasonLead: string | null;
	scale: RangeScale;
	/** Whether the rows carry a range. In season they do not, so the board draws no Range column,
	 * no switch for it and no Range row in its basis. */
	range: boolean;
	/** How many players the whole board ranks, the population every round tint is counted in. */
	boardSize: number;
	/** The drafts behind this format's ADP and their window, from the run: "PPR drafts, Sep 5 to Sep 9". */
	adpBasis: string[];
	/** The Basis panel's rows, in order. */
	basisTerms: BasisTerm[];
	/** How every row frames his rank against the drafts (run/row-framing.ts). */
	framing: RowFraming;
	/** The run's injury capture, null when the run carries none: the basis line names it, said again
	 * on the member's clock once the page is live. */
	capture: CaptureStamp | null;
	/** The status words as built, on the Eastern clock (the page says them again on the member's). */
	statusWords: BoardStatusWords | null;
}

/** A format's board, or the page saying the run lacks it. */
export type BoardRoute =
	{ kind: 'board'; page: BoardPage } | { kind: 'absent'; page: AbsentFormatPage };

export async function boardPage(formatId: string, segment: string | null): Promise<BoardPage> {
	const position = segment === null ? null : positionFromSegment(segment);
	if (segment !== null && position === null) error(NOT_FOUND, 'No such position.');
	const format = await formatForRoute(formatId, (id) => links.board(id, position));
	const [loaded, formats, sources, capture] = await Promise.all([
		board(format.id),
		formatChips(),
		adp(),
		designations()
	]);
	// A kicker's or a defense's view lists his position in draft order, apart from the ranked rows.
	const marketView = position !== null && isMarketPosition(position);
	const ranked = withStatuses(
		position === null ? loaded.rows : marketView ? [] : rowsAt(loaded.rows, position),
		capture
	);
	const market = marketView
		? withStatuses(marketAt(loaded.market, position), capture).map(withFace)
		: [];
	if (ranked.length === 0 && market.length === 0)
		error(NOT_FOUND, 'This board ranks nobody at that position.');
	const { rows, lead } = await boardSeason(format, ranked);
	const range = carriesRange(rows);
	const adpBasis = sources.sources
		.filter((source) => source.formats.includes(format.id))
		.map((source) => `${source.drafts}, ${windowLabel(source.window)}`);
	return {
		format,
		formats,
		position,
		positions: positionsIn([...loaded.rows, ...loaded.market]),
		rows,
		market,
		marketBasis: marketView ? marketBasis(format, sources.sources) : null,
		seasonLead: marketView ? null : lead,
		scale: rangeScale(rows.length > 0 ? rows : loaded.rows),
		range,
		boardSize: loaded.rows.length,
		adpBasis,
		basisTerms: boardBasisTerms({
			format,
			scoring: scoringBasis(format),
			underway: lead !== null,
			boardSize: loaded.rows.length,
			adpBasis,
			range
		}),
		framing: rowFraming(format),
		...boardStatuses([...rows, ...market], capture, format)
	};
}

/** /board/<format>: the All view of a format the run carries, or the page for one it lacks. */
export async function boardRoute(formatId: string): Promise<BoardRoute> {
	const route = await formatRoute(formatId, (id) => links.board(id));
	return route.kind === 'run'
		? { kind: 'board', page: await boardPage(route.format.id, null) }
		: { kind: 'absent', page: await absentFormatPage(route.format) };
}

/** Every format slug a board route answers: canonical ids, short slugs that redirect, and the
 * chooser's formats the run lacks. */
export async function boardFormatEntries(): Promise<{ format: string }[]> {
	return (await formatSlugs()).map((format) => ({ format }));
}

/** Every position view the build prerenders: each carried format's slugs, each position its board ranks. */
export async function boardEntries(): Promise<{ format: string; position: string }[]> {
	const [{ formats }, slugs] = await Promise.all([manifest(), runFormatSlugs()]);
	const positions = new Set<string>();
	for (const format of formats) {
		const loaded = await board(format.id);
		for (const position of positionsIn([...loaded.rows, ...loaded.market])) {
			positions.add(position.toLowerCase());
		}
	}
	return slugs.flatMap((format) => [...positions].map((position) => ({ format, position })));
}
