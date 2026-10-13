/** The record in the words a page prints: its one big number and each week as a person says it.
 * The record page and the front door both read these, so the headline is said one way. */
import { dayLabel } from '#lib/format/date.ts';
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
	return record.weeks.filter((week) => week.gradedAt !== null);
}

/** "weeks 1 to 3", "week 1". */
function weekSpan(weeks: readonly RecordWeek[]): string {
	const first = weeks.at(0)?.week;
	const last = weeks.at(-1)?.week;
	if (first === undefined || last === undefined) return '';
	return first === last ? `week ${String(first)}` : `weeks ${String(first)} to ${String(last)}`;
}

/** Graded: our agreement with the finish over every graded week, with the span and the players it
 * counts, and ADP's beside it. Not yet: how many weeks are graded and how many wait, said plainly. */
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
	const waiting = record.weeks.length - graded.length;
	return {
		value: String(graded.length),
		caption:
			waiting === 0
				? 'weeks graded. The first board freezes before the next kickoff'
				: `weeks graded. ${plural(waiting, 'board')} frozen before kickoff, graded after the games`,
		graded: false
	};
}

/** "frozen Sep 8, graded after the games", or "frozen Sep 8, graded Sep 15". */
export function weekWords(week: RecordWeek): string {
	const graded =
		week.gradedAt === null ? 'graded after the games' : `graded ${dayLabel(week.gradedAt)}`;
	return `frozen ${dayLabel(week.frozenAt)}, ${graded}`;
}
