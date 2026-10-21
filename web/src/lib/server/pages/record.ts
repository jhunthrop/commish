/** The record page: the run's record as written, with the format it is graded in, and the set weeks
 * whose first kickoff is still ahead of the run (from the run's schedule and its time, never the
 * reader's clock). No figure on the record reads the hourly injury capture: a set order is graded as
 * it was set, so the page says no capture time (Lane 82). Lane 114: the weekly record in the record's
 * shape, beside the draft record the run carries. */
import { weeklyAsRecord } from '#lib/run/records.ts';
import type { Format, RunRecord } from '#lib/run/schema.ts';
import { formatById, manifest, record, schedule } from '../run.ts';

export interface RecordPage {
	record: RunRecord;
	format: Format;
	/** Set weeks not played yet when the run was made: their first kickoff is after the run. */
	unplayed: number[];
	/** The weekly record (Lane 114), null on a run before it. */
	weekly: { record: RunRecord; fromWeek: number; unplayed: number[] } | null;
}

/** The set weeks whose first kickoff is after the run, by the run's schedule and its own time: the
 * record page and the front door's card say them the same way. */
export async function unplayedWeeks(loaded: RunRecord): Promise<number[]> {
	const [run, slates] = await Promise.all([manifest(), schedule()]);
	const firstKickoff = new Map<number, number>();
	for (const game of slates.slates.flatMap((slate) => slate.games)) {
		const at = Date.parse(game.kickoff);
		firstKickoff.set(game.week, Math.min(firstKickoff.get(game.week) ?? at, at));
	}
	const ranAt = Date.parse(run.runAt);
	return loaded.weeks
		.filter((week) => week.status === 'frozen' && (firstKickoff.get(week.week) ?? 0) > ranAt)
		.map((week) => week.week);
}

/** A record's weeks without their graded players: those are a league's alone (Lane 93), the page
 * carries none and their file holds them. */
function withoutPlayers(loaded: RunRecord): RunRecord {
	return { ...loaded, weeks: loaded.weeks.map((week) => ({ ...week, players: undefined })) };
}

export async function recordPage(): Promise<RecordPage> {
	const loaded = await record();
	const unplayed = await unplayedWeeks(loaded);
	const weekly = weeklyAsRecord(loaded);
	return {
		// The weekly record travels once, in the record's shape below.
		record: withoutPlayers({ ...loaded, weekly: undefined }),
		format: await formatById(loaded.format),
		unplayed,
		weekly:
			weekly === null || loaded.weekly === undefined
				? null
				: {
						record: withoutPlayers(weekly),
						fromWeek: loaded.weekly.fromWeek,
						unplayed: await unplayedWeeks(weekly)
					}
	};
}
