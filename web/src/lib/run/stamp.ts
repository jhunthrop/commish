import { dayLabel } from '#lib/format/date.ts';

/** What every nightly page prints about its run: which run, when, and the players its search finds. */
export interface RunStamp {
	runId: string;
	/** When the run finished, ISO. */
	runAt: string;
	season: number;
	/** The stand-in built from the approved mocks' data, before the first real nightly run. */
	standIn: boolean;
	/** The search's placeholder, its count of ranked players in words (format/pool-words.ts), built
	 * with the page so the shell's script carries no count words. */
	search: string;
	/** Every format the run carries, by its run id ("ppr-12"), the default first. */
	formats: string[];
	/** The week the default board ranks the rest of the season from, in season; absent before it
	 * (Lane 140: the rail's week order is named for it). */
	week?: number;
	/** In season at the page's clock, the Players page's name, "Week 7 rankings", built by the layout
	 * (run/week-names.ts): the rail's item, the page's head and its crumb. Absent before the season. */
	weekRankings?: string;
	/** With it, the page's rank head, "Week 7 rank" (Lane 142). */
	weekRank?: string;
}

/** The stamp's words: "run" is our word, never the page's (B53). */
export const STAMP_WORDS = {
	updated: 'Updated',
	standIn: 'Stand-in, updated'
} as const;

/** "Updated Oct 12", or "Stand-in, updated Oct 12" before the first real run. */
export function runStampText(run: RunStamp): string {
	return `${run.standIn ? STAMP_WORDS.standIn : STAMP_WORDS.updated} ${dayLabel(run.runAt)}`;
}
