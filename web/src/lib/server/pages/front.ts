/** The front door: the top of the default board, and the record's headline, from the run. */
import { rangeScale } from '#lib/run/derive.ts';
import { recordHeadline, type RecordHeadline } from '#lib/run/record.ts';
import type { Format } from '#lib/run/schema.ts';
import type { RangeScale } from '#lib/types/player.ts';
import { boardSeason, type BoardRowView } from '../board-season.ts';
import { board, defaultFormat, record } from '../run.ts';

/** How many of the board's top rows the front door shows. */
const TOP_ROWS = 10;

export interface FrontPage {
	format: Format;
	/** Each with his season figures once the season is underway. */
	rows: BoardRowView[];
	/** The strip's basis line once the season is underway, null before the first kickoff. */
	seasonLead: string | null;
	scale: RangeScale;
	/** How many players the whole board ranks. */
	boardSize: number;
	/** The record's one number and its caption, the only part of the record the front door prints. */
	record: RecordHeadline & { season: number };
}

export async function frontPage(): Promise<FrontPage> {
	const format = await defaultFormat();
	const [loaded, kept] = await Promise.all([board(format.id), record()]);
	const { rows, lead } = await boardSeason(format, loaded.rows.slice(0, TOP_ROWS));
	return {
		format,
		rows,
		seasonLead: lead,
		scale: rangeScale(rows),
		boardSize: loaded.rows.length,
		record: { ...recordHeadline(kept), season: kept.season }
	};
}
