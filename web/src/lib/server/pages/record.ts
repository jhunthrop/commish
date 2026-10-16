/** The record page: the run's record as written, with the format it is graded in, and the frozen
 * weeks whose first kickoff is still ahead of the run (from the run's schedule and its time, never
 * the reader's clock). */
import type { Format, RunRecord } from '#lib/run/schema.ts';
import { BUILT_ZONE, recordStatusWords } from '#lib/run/status-view.ts';
import { designations, formatById, manifest, record, schedule } from '../run.ts';

export interface RecordPage {
	record: RunRecord;
	format: Format;
	/** Frozen weeks not played yet when the run was made: their first kickoff is after the run. */
	unplayed: number[];
	/** When the run's injury capture was read, null when it carries none: the method words name it. */
	statusRead: string | null;
	/** The method words beside it as built, on the Eastern clock. */
	statusWords: string | null;
}

export async function recordPage(): Promise<RecordPage> {
	const [loaded, run, slates, capture] = await Promise.all([
		record(),
		manifest(),
		schedule(),
		designations()
	]);
	const firstKickoff = new Map<number, number>();
	for (const game of slates.slates.flatMap((slate) => slate.games)) {
		const at = Date.parse(game.kickoff);
		firstKickoff.set(game.week, Math.min(firstKickoff.get(game.week) ?? at, at));
	}
	const ranAt = Date.parse(run.runAt);
	const unplayed = loaded.weeks
		.filter((week) => week.status === 'frozen' && (firstKickoff.get(week.week) ?? 0) > ranAt)
		.map((week) => week.week);
	return {
		record: loaded,
		format: await formatById(loaded.format),
		unplayed,
		statusRead: capture?.readAt ?? null,
		statusWords: capture === null ? null : recordStatusWords(capture.readAt, BUILT_ZONE)
	};
}
