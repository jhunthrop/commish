/** The run's injury capture as a page's loader says it (Lane 63): the stamp the page carries for its
 * live clock, and the clock the built words are said on, the Eastern zone at the build's instant. */
import type { CaptureStamp } from '#lib/format/designation.ts';
import type { Designations, Format } from '#lib/run/schema.ts';
import { BUILT_ZONE, type Saying } from '#lib/run/status-view.ts';

export function captureStamp(capture: Designations): CaptureStamp {
	return { readAt: capture.readAt, checkedAt: capture.checkedAt };
}

export function builtSaying(capture: Designations, format: Pick<Format, 'rosFromWeek'>): Saying {
	return {
		capture: captureStamp(capture),
		restOfSeason: format.rosFromWeek !== undefined,
		zone: BUILT_ZONE,
		now: Date.now()
	};
}
