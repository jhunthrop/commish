import { dayLabel } from '#lib/format/date.ts';

/** What every nightly page prints about its run: which run, when, and how many players it covers. */
export interface RunStamp {
	runId: string;
	/** When the run finished, ISO. */
	runAt: string;
	season: number;
	/** The stand-in built from the approved mocks' data, before the first real nightly run. */
	standIn: boolean;
	players: number;
	/** Every format the run carries, by its run id ("ppr-12"), the default first. */
	formats: string[];
}

/** "Run of Oct 12", or "Stand-in run of Oct 12" before the first real run. */
export function runStampText(run: RunStamp): string {
	return `${run.standIn ? 'Stand-in run' : 'Run'} of ${dayLabel(run.runAt)}`;
}
