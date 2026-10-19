/** The run's injury capture as a page's loader says it (Lane 63): the stamp the page carries for its
 * live clock, and the clock the built words are said on, the Eastern zone at the build's instant. */
import type { CaptureStamp } from '#lib/format/designation.ts';
import type { Designations, Format } from '#lib/run/schema.ts';
import {
	BUILT_ZONE,
	boardStatusWords,
	type BoardStatusWords,
	type ListedRow,
	type Saying
} from '#lib/run/status-view.ts';

export function captureStamp(capture: Designations): CaptureStamp {
	return { readAt: capture.readAt, checkedAt: capture.checkedAt };
}

export function builtSaying(
	capture: Designations,
	format: Pick<Format, 'rosFromWeek'>,
	now: number
): Saying {
	return {
		capture: captureStamp(capture),
		restOfSeason: format.rosFromWeek !== undefined,
		zone: BUILT_ZONE,
		now
	};
}

/** What a page drawing board rows carries for their statuses: the stamp its live clock says again,
 * and the rows' words as built. Both null when the run carries no capture. */
export interface BoardStatuses {
	capture: CaptureStamp | null;
	statusWords: BoardStatusWords | null;
}

export function boardStatuses(
	rows: readonly ListedRow[],
	capture: Designations | null,
	format: Pick<Format, 'rosFromWeek'>,
	now: number
): BoardStatuses {
	return capture === null
		? { capture: null, statusWords: null }
		: {
				capture: captureStamp(capture),
				statusWords: boardStatusWords(rows, builtSaying(capture, format, now))
			};
}
