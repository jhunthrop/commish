/** The record in the words a page prints: its one big number and each week as a person says it.
 * The record page and the front door both read these, so the headline is said one way. */
import { dayLabel, weekdayLabel } from '#lib/format/date.ts';
import { fixed, plural } from '#lib/format/number.ts';
import type { RecordLine, RecordWeek, RunRecord, Score } from './schema.ts';

/** The record's one number and its caption. */
export interface RecordHeadline {
	value: string;
	caption: string;
	/** True once a week is graded and the number is our agreement with the finish. */
	graded: boolean;
}

/** A phrase with its first letter capital. */
function capitalized(words: string): string {
	return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
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

/** The agreement statistic as the record names it: "order matched" (Lane 66j). */
export function rankAgreement(record: RunRecord): string {
	return record.statistic.agreement;
}

/** Graded: our rank agreement with the finish over every graded week, its scale, the span and the
 * players it counts, and ADP's beside it. Not yet: how many of the frozen weeks are graded. */
export function recordHeadline(record: RunRecord): RecordHeadline {
	const graded = gradedWeeks(record);
	const overall = allLine(record.toDate);
	const agreement = overall?.ours.agreement;
	if (overall && agreement !== null && agreement !== undefined && graded.length > 0) {
		const adp = overall.adp.agreement;
		const adpPart = adp === null ? '' : `. ADP ${fixed(adp, 2)} on the same players`;
		return {
			value: fixed(agreement, 2),
			caption: `${capitalized(rankAgreement(record))}, ours over ${weekSpan(graded)} and ${plural(overall.ours.graded, 'player')}${adpPart}. ${record.scale}`,
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

/** One line of the week list: a week, or a run of missed or upcoming weeks said once. */
export interface WeekLine {
	/** "Week 1", "Weeks 3 to 5". */
	lead: string;
	/** "frozen Sep 8, graded Oct 14", "not frozen because our weekly freeze failed, so not graded", "next freeze Thu Oct 22". */
	text: string;
	/** The week a graded or frozen line speaks for, so a page can add its figures. Null for a run. */
	week: RecordWeek | null;
}

/** "Week 1", "Weeks 3 to 5". */
function lead(weeks: readonly RecordWeek[]): string {
	const span = weekSpan(weeks);
	return `${span.charAt(0).toUpperCase()}${span.slice(1)}`;
}

/** A graded or frozen week as a person says it: "frozen Sep 8, graded Oct 14", "frozen Oct 13, not
 * played yet" before its first kickoff, "frozen Oct 13, waiting on the stat lines" after it. */
function frozenWords(week: RecordWeek, unplayed: readonly number[]): string {
	const frozen = `frozen ${stamp(week.frozenAt, week)}`;
	if (week.status === 'graded') return `${frozen}, graded ${stamp(week.gradedAt, week)}`;
	return unplayed.includes(week.week)
		? `${frozen}, not played yet`
		: `${frozen}, waiting on the stat lines`;
}

/** A missed week's reason as a clause: the run's note ("Our weekly freeze failed that week.") with its
 * capital, its full stop and its "that week" dropped, "our weekly freeze failed". The run must say
 * why a week was missed: the record never hides a gap. */
function reason(week: RecordWeek): string {
	if (week.note === undefined) throw new Error(`Week ${String(week.week)} is missed with no note.`);
	const clause = week.note.replace(/\.$/, '').replace(/ that week$/, '');
	return `${clause.charAt(0).toLowerCase()}${clause.slice(1)}`;
}

/** A run of weeks said once: missed ones with why, or what is left with the next freeze from the
 * schedule. */
function runWords(first: RecordWeek): string {
	if (first.status === 'missed') return `not frozen because ${reason(first)}, so not graded`;
	return first.frozenAt === null
		? 'the first board freezes before its first kickoff'
		: `next freeze ${weekdayLabel(first.frozenAt)}`;
}

/** Whether a week joins the run before it: the same status, missed or upcoming, and for missed weeks
 * the same reason, so two causes never share a line. */
function joins(run: readonly RecordWeek[] | undefined, week: RecordWeek): boolean {
	const first = run?.[0];
	if (first?.status !== week.status) return false;
	if (week.status === 'missed') return reason(first) === reason(week);
	return week.status === 'upcoming';
}

/** The season week by week, each run of missed weeks one line ("Weeks 3 to 5, not frozen because our
 * weekly freeze failed, so not graded") and every week still to come one line ("Weeks 7 to 18, next
 * freeze Thu Oct 22"), so the list says what happened and what is next rather than logging each
 * week alike. `unplayed` names the frozen weeks whose first kickoff is still ahead of the run. */
export function weekLines(
	weeks: readonly RecordWeek[],
	unplayed: readonly number[] = []
): WeekLine[] {
	const runs: RecordWeek[][] = [];
	for (const week of weeks) {
		const last = runs.at(-1);
		if (last !== undefined && joins(last, week)) runs[runs.length - 1] = [...last, week];
		else runs.push([week]);
	}
	return runs.map((run) => {
		const [first] = run;
		if (first === undefined) throw new Error('A run of weeks is never empty.');
		const grouped = first.status === 'missed' || first.status === 'upcoming';
		return grouped
			? { lead: lead(run), text: runWords(first), week: null }
			: { lead: lead(run), text: frozenWords(first, unplayed), week: first };
	});
}

/** The three orders a record row compares, ours first. */
export const RECORD_SOURCES = ['ours', 'adp', 'published'] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];

/** The three figures a record row gives each order (Lane 66j). */
export const RECORD_FIGURES = ['agreement', 'placesOff', 'starters'] as const;
export type RecordFigure = (typeof RECORD_FIGURES)[number];

/** The record box score's words, in one place for the copy guard. */
export const RECORD_BOX = {
	week: 'Week',
	players: 'Players',
	status: 'Status',
	ours: 'Ours',
	adp: 'ADP',
	published: 'Published',
	toDate: 'To date',
	none: '--',
	chart: 'Order matched by week'
} as const;

/** One order's score in a line, null where the line has none (the published projection before its
 * first graded week). */
export function scoreOf(line: RecordLine | undefined, source: RecordSource): Score | null {
	if (line === undefined) return null;
	return line[source];
}

/** A figure as its cell prints it: two decimals for order matched, one for places off, the starters as
 * "50 of 84", "--" when not held. Every figure is the run's. */
export function figureWords(score: Score | null, figure: RecordFigure): string {
	if (score === null) return RECORD_BOX.none;
	if (figure === 'agreement')
		return score.agreement === null ? 'Too few' : fixed(score.agreement, 2);
	if (figure === 'placesOff')
		return score.placesOff === null ? RECORD_BOX.none : fixed(score.placesOff, 1);
	return score.startersOf === 0
		? RECORD_BOX.none
		: `${String(score.starters)} of ${String(score.startersOf)}`;
}

/** The published projection's columns' basis: from which week it counts. */
export function publishedWords(record: RunRecord): string {
	return `Published is one provider's weekly projection, read before each kickoff, graded from week ${String(record.publishedFromWeek)} as it accrues, ${RECORD_BOX.none} before.`;
}

/** The chart's three series: each graded week's order matched for one position, in week order. */
export function chartSeries(
	record: RunRecord,
	position: RecordLine['position']
): Record<RecordSource, { week: number; value: number }[]> {
	const out: Record<RecordSource, { week: number; value: number }[]> = {
		ours: [],
		adp: [],
		published: []
	};
	for (const week of record.weeks) {
		if (week.status !== 'graded') continue;
		const line = week.lines.find((l) => l.position === position);
		for (const source of RECORD_SOURCES) {
			const value = scoreOf(line, source)?.agreement;
			if (value !== null && value !== undefined) out[source].push({ week: week.week, value });
		}
	}
	return out;
}
