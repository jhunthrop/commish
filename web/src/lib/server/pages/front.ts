/** The front door: the top of the default board in the board's order, and the record's headline,
 * from the run. */
import { carriesGap } from '#lib/format/gap.ts';
import { adpDrafts } from '#lib/run/adp-drafts.ts';
import { boardBasis, type BasisPart } from '#lib/run/board-basis.ts';
import { withStatuses } from '#lib/run/board-status.ts';
import { rangeScale } from '#lib/run/derive.ts';
import { recordHeadline, type RecordHeadline } from '#lib/run/record.ts';
import { rowFraming, type RowFraming } from '#lib/run/row-framing.ts';
import type { BoardRowView, Format } from '#lib/run/schema.ts';
import type { RangeScale } from '#lib/types/player.ts';
import { boardSeason } from '../board-season.ts';
import { boardStatuses, type BoardStatuses } from '../statuses.ts';
import { adp, board, clubByes, defaultFormat, designations, manifest, record } from '../run.ts';

/** How many of the board's top rows the front door shows. */
const TOP_ROWS = 10;

export interface FrontPage extends BoardStatuses {
	format: Format;
	/** Each with his season figures once the season is underway. */
	rows: BoardRowView[];
	/** The strip's basis, said once under its head (Lane 66n). */
	basis: BasisPart[];
	/** The season is underway: the rows carry this season's GP and A game. */
	/** The screen shows the Gap: the board compares drafters with our rank and the run carries the
	 * figure on one of its rows (re-review N1). */
	gap: boolean;
	underway: boolean;
	/** Each club's bye week, for the rows' Bye column. */
	byes: Record<string, number | null>;
	scale: RangeScale;
	/** How every row frames his rank against the drafts, as the board does (run/row-framing.ts). */
	framing: RowFraming;
	/** How many players the whole board ranks. */
	boardSize: number;
	/** The record's one number and its caption, the only part of the record the front door prints. */
	record: RecordHeadline & { season: number };
}

export async function frontPage(now: number): Promise<FrontPage> {
	const format = await defaultFormat();
	const [loaded, kept, capture, sources, byes, run] = await Promise.all([
		board(format.id),
		record(),
		designations(),
		adp(),
		clubByes(),
		manifest()
	]);
	// A player on a season-long list is never in the top as if he plays (Lane 63): the strip is the
	// board's own order, which puts him below the available players at his position.
	const top = withStatuses(loaded.rows, capture).slice(0, TOP_ROWS);
	const { rows, reach } = await boardSeason(format, top);
	const showsGap = rowFraming(format).compare && carriesGap(rows);
	return {
		format,
		rows,
		basis: boardBasis({
			format,
			season: run.season,
			order: 'board',
			adpBasis: adpDrafts(sources.sources, format.id),
			gap: showsGap,
			reach
		}),
		gap: showsGap,
		underway: reach !== null,
		byes,
		scale: rangeScale(rows),
		framing: rowFraming(format),
		boardSize: loaded.rows.length,
		record: { ...recordHeadline(kept), season: kept.season },
		// The rows' statuses as the board's, drawn with the shared pill (review finding 7).
		...boardStatuses(rows, capture, format, now)
	};
}
