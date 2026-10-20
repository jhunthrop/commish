/** The front door: the top of the default board in the board's order, and the record's headline,
 * from the run. */
import { carriesGap } from '#lib/format/gap.ts';
import { poolCount } from '#lib/format/pool-words.ts';
import { adpDrafts } from '#lib/run/adp-drafts.ts';
import { boardRestFrom } from '#lib/run/rest-from.ts';
import { boardBasis, type BasisPart } from '#lib/run/board-basis.ts';
import { withStatuses } from '#lib/run/board-status.ts';
import { rangeScale } from '#lib/run/derive.ts';
import { recordHeadline, type RecordHeadline } from '#lib/run/record.ts';
import { rowFraming, type RowFraming } from '#lib/run/row-framing.ts';
import type { BoardRowView, Format } from '#lib/run/schema.ts';
import type { RangeScale } from '#lib/types/player.ts';
import { boardSeason } from '../board-season.ts';
import { boardStatuses, type BoardStatuses } from '../statuses.ts';
import { unplayedWeeks } from './record.ts';
import { adp, board, clubByes, defaultFormat, designations, manifest, record } from '../run.ts';

import { STRIP_POOL, STRIP_ROWS } from '#lib/front/live-board.ts';

export interface FrontPage extends BoardStatuses {
	format: Format;
	/** The week the board's rest of season counts from, in the run's words; null on a full-season
	 * board (Lane 86, review H2). */
	restFrom: string | null;
	/** Each with his season figures once the season is underway. */
	rows: BoardRowView[];
	/** The run's top STRIP_POOL rows, the strip's first among them: a signed-in member's strip draws
	 * the API's live order from them (front/live-board.ts, Lane 96). */
	pool: BoardRowView[];
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
	/** That count with its pool named, as the strip's link says it: "619 on our board". */
	boardCount: string;
	/** The record's headline, the only part of the record the front door prints, with the measure's
	 * definition (Lane 93: starters right and the graded count beside the figure). */
	record: RecordHeadline & { season: number; scale: string };
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
	const top = withStatuses(loaded.rows, capture).slice(0, STRIP_POOL);
	const { rows: pool, reach } = await boardSeason(format, top);
	const rows = pool.slice(0, STRIP_ROWS);
	const showsGap = rowFraming(format).compare && carriesGap(rows);
	return {
		format,
		restFrom: boardRestFrom(format),
		rows,
		pool,
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
		boardCount: poolCount(loaded.rows.length, 'board'),
		record: {
			...recordHeadline(kept, await unplayedWeeks(kept)),
			season: kept.season,
			scale: kept.scale
		},
		// The rows' statuses as the board's, drawn with the shared pill (review finding 7).
		...boardStatuses(pool, capture, format, now)
	};
}
