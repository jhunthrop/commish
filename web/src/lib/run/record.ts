/** The record in the words a page prints: its one big number and each week as a person says it.
 * The record page and the front door both read these, so the headline is said one way. */
import { dayLabel, weekdayLabel } from '#lib/format/date.ts';
import { fixed, plural } from '#lib/format/number.ts';
import type { RecordLine, RecordWeek, RunRecord } from './schema.ts';

/** The record's one number and its caption. */
export interface RecordHeadline {
	value: string;
	caption: string;
	/** True once a week is graded and the number is our agreement with the finish. */
	graded: boolean;
}

/** A pooled line for every position, the one the headline and each week's line lead with. */
export function allLine(lines: readonly RecordLine[]): RecordLine | undefined {
	return lines.find((line) => line.position === 'All');
}

function gradedWeeks(record: RunRecord): RecordWeek[] {
	return record.weeks.filter((week) => week.status === 'graded');
}

/** Weeks whose board froze, graded or still waiting on the stat lines. */
function frozenWeeks(record: RunRecord): RecordWeek[] {
	return record.weeks.filter((week) => week.status === 'graded' || week.status === 'frozen');
}

/** "weeks 1 to 3", "week 1". */
function weekSpan(weeks: readonly RecordWeek[]): string {
	const first = weeks.at(0)?.week;
	const last = weeks.at(-1)?.week;
	if (first === undefined || last === undefined) return '';
	return first === last ? `week ${String(first)}` : `weeks ${String(first)} to ${String(last)}`;
}

/** Graded: our agreement with the finish over every graded week, with the span and the players it
 * counts, and ADP's beside it. Not yet: how many of the frozen weeks are graded, said plainly. */
export function recordHeadline(record: RunRecord): RecordHeadline {
	const graded = gradedWeeks(record);
	const overall = allLine(record.toDate);
	const agreement = overall?.ours.agreement;
	if (overall && agreement !== null && agreement !== undefined && graded.length > 0) {
		const adp = overall.adp.agreement;
		const adpPart = adp === null ? '' : `. ADP ${fixed(adp, 2)} on the same players`;
		return {
			value: fixed(agreement, 2),
			caption: `our ${record.statistic.agreement}, ${weekSpan(graded)}, ${plural(overall.ours.graded, 'player')}${adpPart}`,
			graded: true
		};
	}
	const frozen = frozenWeeks(record).length;
	return {
		value: String(graded.length),
		caption:
			frozen === 0
				? 'weeks graded. The first board freezes before its first kickoff'
				: `of ${plural(frozen, 'frozen week')} graded`,
		graded: false
	};
}

/** A time the schema guarantees for the status, read without a fallback that could print. */
function stamp(iso: string | null, week: RecordWeek): string {
	if (iso === null) throw new Error(`Week ${String(week.week)} is ${week.status} with no date.`);
	return dayLabel(iso);
}

/** Each week as a person says it, by its status: "frozen Sep 8, waiting on the stat lines",
 * "not frozen. Our nightly run failed that week", "freezes Thu Oct 15". */
export function weekWords(week: RecordWeek): string {
	switch (week.status) {
		case 'graded':
			return `frozen ${stamp(week.frozenAt, week)}, graded ${stamp(week.gradedAt, week)}`;
		case 'frozen':
			return `frozen ${stamp(week.frozenAt, week)}, waiting on the stat lines`;
		case 'missed':
			return `not frozen. ${(week.note ?? '').replace(/\.$/, '')}`;
		case 'upcoming':
			return week.frozenAt === null
				? 'freezes before its first kickoff'
				: `freezes ${weekdayLabel(week.frozenAt)}`;
	}
}
