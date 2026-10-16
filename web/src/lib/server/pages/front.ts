/** The front door: the top of the default board in the board's order, and the record's headline,
 * from the run. */
import { withStatuses } from '#lib/run/board-status.ts';
import { rangeScale } from '#lib/run/derive.ts';
import { recordHeadline, type RecordHeadline } from '#lib/run/record.ts';
import { rowFraming, type RowFraming } from '#lib/run/row-framing.ts';
import type { BoardRowView, Format } from '#lib/run/schema.ts';
import type { RangeScale } from '#lib/types/player.ts';
import { boardSeason } from '../board-season.ts';
import { board, defaultFormat, designations, record } from '../run.ts';

/** How many of the board's top rows the front door shows. */
const TOP_ROWS = 10;

export interface FrontPage {
	format: Format;
	/** Each with his season figures once the season is underway. */
	rows: BoardRowView[];
	/** The strip's basis line once the season is underway, null before the first kickoff. */
	seasonLead: string | null;
	scale: RangeScale;
	/** How every row frames his rank against the drafts, as the board does (run/row-framing.ts). */
	framing: RowFraming;
	/** How many players the whole board ranks. */
	boardSize: number;
	/** The record's one number and its caption, the only part of the record the front door prints. */
	record: RecordHeadline & { season: number };
}

export async function frontPage(): Promise<FrontPage> {
	const format = await defaultFormat();
	const [loaded, kept, capture] = await Promise.all([board(format.id), record(), designations()]);
	// A player on a season-long list is never in the top as if he plays (Lane 63): the strip is the
	// board's own order, which puts him below the available players at his position.
	const top = withStatuses(loaded.rows, capture).slice(0, TOP_ROWS);
	const { rows, lead } = await boardSeason(format, top);
	return {
		format,
		rows,
		seasonLead: lead,
		scale: rangeScale(rows),
		framing: rowFraming(format),
		boardSize: loaded.rows.length,
		record: { ...recordHeadline(kept), season: kept.season }
	};
}
