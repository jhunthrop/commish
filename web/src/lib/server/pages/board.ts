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
import type { BoardRowView, Format } from '#lib/run/schema.ts';
import type { Position, RangeScale } from '#lib/types/player.ts';
import { scoringBasis } from '#lib/run/catalog.ts';
import { links } from '#lib/site/links.ts';
import { windowLabel } from '#lib/format/date.ts';
import { boardSeason } from '../board-season.ts';
import { adp, board, manifest } from '../run.ts';
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

/** One row of the board's Basis panel: a colour or column, and what it stands for. */
export interface BasisTerm {
	term: string;
	means: string;
}

export interface BoardPage {
	format: Format;
	formats: FormatChip[];
	/** null is the All view. */
	position: Position | null;
	positions: Position[];
	/** Each with his season figures once the season is underway. */
	rows: BoardRowView[];
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
}

/** The Basis panel: the scoring; in season the order and the tiers (the lead names the sort and the
 * season); the round tint against the whole board; below replacement; the drafters' ADP; and last
 * the range, when the rows carry one, so the band that hides its column hides its line. */
function basisTerms(
	format: Format,
	seasonLead: string | null,
	boardSize: number,
	adpBasis: readonly string[],
	range: boolean
): BasisTerm[] {
	return [
		{ term: 'Scoring', means: scoringBasis(format) },
		...(seasonLead === null ? [] : [{ term: 'Order', means: format.basis.slice(1).join(', ') }]),
		{
			term: 'Green',
			means: `The round his points over replacement rank in, among ${String(boardSize)}`
		},
		{ term: 'Rose', means: 'Below replacement' },
		{ term: 'Drafters', means: `Their ADP from ${adpBasis.join(' and ')}, against our rank` },
		// Last, so the band that hides the range column hides its line too (BoardView's style).
		...(range ? [{ term: 'Range', means: 'Floor to ceiling' }] : [])
	];
}

/** A format's board, or the page saying the run lacks it. */
export type BoardRoute =
	{ kind: 'board'; page: BoardPage } | { kind: 'absent'; page: AbsentFormatPage };

export async function boardPage(formatId: string, segment: string | null): Promise<BoardPage> {
	const position = segment === null ? null : positionFromSegment(segment);
	if (segment !== null && position === null) error(NOT_FOUND, 'No such position.');
	const format = await formatForRoute(formatId, (id) => links.board(id, position));
	const [loaded, formats, sources] = await Promise.all([board(format.id), formatChips(), adp()]);
	const ranked = position === null ? loaded.rows : rowsAt(loaded.rows, position);
	if (ranked.length === 0) error(NOT_FOUND, 'This board ranks nobody at that position.');
	const { rows, lead } = await boardSeason(format, ranked);
	const range = carriesRange(rows);
	const adpBasis = sources.sources
		.filter((source) => source.formats.includes(format.id))
		.map((source) => `${source.drafts}, ${windowLabel(source.window)}`);
	return {
		format,
		formats,
		position,
		positions: positionsIn(loaded.rows),
		rows,
		seasonLead: lead,
		scale: rangeScale(rows),
		range,
		boardSize: loaded.rows.length,
		adpBasis,
		basisTerms: basisTerms(format, lead, loaded.rows.length, adpBasis, range)
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
		for (const position of positionsIn((await board(format.id)).rows)) {
			positions.add(position.toLowerCase());
		}
	}
	return slugs.flatMap((format) => [...positions].map((position) => ({ format, position })));
}
