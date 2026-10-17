/** The member's own clock for a page's injury status words (Lane 63). The board, player and record
 * pages are built on the Eastern clock at the build's instant, so the HTML and its first frame agree.
 * Once the page is live, `liveStatusClock` loads the words module (run/status-view.ts) after the
 * first paint and hands back the browser's zone and the reader's instant, at which the words are said
 * again and a capture is judged behind. No page's first script carries the words or the clock, and
 * this file imports nothing (the page hands it the words' lazy import), so its chunk never takes the
 * framework's or the bundler's own code out of the shared chunk. A page calls it from its onMount,
 * keeping what it hands back in its own state:
 *
 *   let live = $state<LiveStatus | null>(null);
 *   onMount(() => liveStatusClock(hasCapture, () => import('#lib/run/status-view.ts'), (said) => (live = said)));
 */
import type { CaptureStamp } from '#lib/format/designation.ts';
import type * as StatusWords from './status-view.ts';
import type { BoardStatusWords, ListedRow } from './status-view.ts';

export interface LiveStatus {
	zone: string;
	now: number;
	words: typeof StatusWords;
}

/** Loads the words when the page has a capture to say, and hands them over with the zone and the
 * instant. Without a capture nothing is loaded. */
export function liveStatusClock(
	wanted: boolean,
	load: () => Promise<typeof StatusWords>,
	said: (live: LiveStatus) => void
): void {
	if (!wanted) return;
	void load().then((words) => {
		said({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, now: Date.now(), words });
	});
}

/** A board's rows' words: as built until the live clock answers, then said again on it. The board,
 * the ADP page and a club page draw their rows' statuses through it. */
export function sayBoard(
	page: {
		rows: readonly ListedRow[];
		/** The kickers and defenses the page lists in draft order, when it lists any. */
		market?: readonly ListedRow[];
		capture: CaptureStamp | null;
		statusWords: BoardStatusWords | null;
		format: { rosFromWeek?: number };
	},
	live: LiveStatus | null
): BoardStatusWords | null {
	if (live === null || page.capture === null) return page.statusWords;
	return live.words.boardStatusWords([...page.rows, ...(page.market ?? [])], {
		capture: page.capture,
		restOfSeason: page.format.rosFromWeek !== undefined,
		zone: live.zone,
		now: live.now
	});
}
