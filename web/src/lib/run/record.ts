/** The record in the words a page prints: its one big number and each week as a person says it.
 * The record page and the front door both read these, so the headline is said one way. */
import { EMPTY_FIGURE } from '#lib/format/empty.ts';
import { dayLabel, weekdayLabel } from '#lib/format/date.ts';
import { plural } from '#lib/format/number.ts';
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

/** Weeks whose board froze, graded or still waiting on the stats. */
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

/** A rate (order matched) prints the run's two decimals, the one figure not to a tenth (ruling R2),
 * said once with the run's scale (scaleWords). */
export const RATE_PLACES = 2;
export const RATE_PLACES_WORDS = 'Rates print to two decimals.';

/** The rank agreement's scale and its two decimals, said once on a page that prints the figure: the
 * graded record's line under its tiles (Lane 66t), named by its head. */
export function scaleWords(record: RunRecord): string {
	return `${capitalized(rankAgreement(record))}: ${record.scale} ${RATE_PLACES_WORDS}`;
}

/** Graded: our rank agreement with the finish over every graded week, its scale, the span and the
 * players it counts, and ADP's beside it. Not yet: how many of the frozen weeks are graded. */
export function recordHeadline(record: RunRecord): RecordHeadline {
	const graded = gradedWeeks(record);
	const overall = allLine(record.toDate);
	const agreement = overall?.ours.agreement;
	if (overall && agreement !== null && agreement !== undefined && graded.length > 0) {
		const adp = overall.adp.agreement;
		const adpPart =
			adp === null ? '' : `. ADP ${printPlaces(adp, RATE_PLACES)} on the same players`;
		return {
			value: printPlaces(agreement, RATE_PLACES),
			caption: `${capitalized(rankAgreement(record))}, ours over ${weekSpan(graded)} and ${plural(overall.ours.graded, 'player')}${adpPart}. ${record.scale} ${RATE_PLACES_WORDS}`,
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
 * played yet" before its first kickoff, "frozen Oct 13, waiting on the stats" after it. */
function frozenWords(week: RecordWeek, unplayed: readonly number[]): string {
	const frozen = `frozen ${stamp(week.frozenAt, week)}`;
	if (week.status === 'graded') return `${frozen}, graded ${stamp(week.gradedAt, week)}`;
	return unplayed.includes(week.week)
		? `${frozen}, not played yet`
		: `${frozen}, waiting on the stats`;
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
	none: EMPTY_FIGURE,
	chart: 'Order matched by week'
} as const;

/** A fixed column of the week table, beside the lead Week column and the figures: its head, its
 * class, and whether it is drawn below 1180px, where the table shows one figure at a time. The
 * table draws its heads from these lists and the status spans count them, so a column added here is
 * spanned at once. A column not drawn narrow is hidden there by its class (the page's styles). */
export interface RecordColumn {
	head: string;
	cls: string;
	narrow: boolean;
}

/** The fixed columns between Week and the figures. */
export const RECORD_BEFORE: readonly RecordColumn[] = [
	{ head: RECORD_BOX.players, cls: 'n plc', narrow: false }
];

/** The fixed columns after the figures. */
export const RECORD_AFTER: readonly RecordColumn[] = [
	{ head: RECORD_BOX.status, cls: 'st', narrow: false }
];

const drawnAt = (columns: readonly RecordColumn[], narrow: boolean): number =>
	columns.filter((column) => !narrow || column.narrow).length;

/** The columns a row that is not graded spans with its status, after its Week cell, at each width:
 * at a desk every fixed column and every figure for each order drawn; below 1180px the fixed columns
 * drawn there and the shown figure's orders. A status spanning a hidden track would keep it alive as
 * an empty strip at the table's right (Lane 87). */
export function recordStatusSpans(sourceCount: number): { desk: number; narrow: number } {
	return {
		desk:
			drawnAt(RECORD_BEFORE, false) +
			RECORD_FIGURES.length * sourceCount +
			drawnAt(RECORD_AFTER, false),
		narrow: drawnAt(RECORD_BEFORE, true) + sourceCount + drawnAt(RECORD_AFTER, true)
	};
}

/** One order's score in a line, null where the line has none (the published projection before its
 * first graded week). */
export function scoreOf(line: RecordLine | undefined, source: RecordSource): Score | null {
	if (line === undefined) return null;
	return line[source];
}

/** A figure the run rounded, printed as given with its places filled out (Lane 66k's ruling:
 * formatting only, never rounded again): 0.5 at two places is "0.50", 43 at one is "43.0". */
export function printPlaces(value: number, places: number): string {
	const [whole = '', frac = ''] = String(value).split('.');
	return `${whole}.${frac.padEnd(places, '0')}`;
}

/** A figure as its cell prints it: two decimals for order matched, one for places off, the starters as
 * "50 of 84", "--" when not held. Every figure is the run's. */
export function figureWords(score: Score | null, figure: RecordFigure): string {
	if (score === null) return RECORD_BOX.none;
	if (figure === 'agreement')
		return score.agreement === null ? 'Too few' : printPlaces(score.agreement, RATE_PLACES);
	if (figure === 'placesOff')
		return score.placesOff === null ? RECORD_BOX.none : printPlaces(score.placesOff, 1);
	return score.startersOf === 0
		? RECORD_BOX.none
		: `${String(score.starters)} of ${String(score.startersOf)}`;
}

/** The published projection's figure to date with ours over the same weeks beside it (review 66j N1):
 * the run pools ours again over the weeks that graded published, so the two compare like with like.
 * `ours` is null on a week's line, where both are graded on the same rows already. */
export function publishedBeside(
	line: RecordLine | undefined,
	figure: RecordFigure
): { published: string; ours: string | null } {
	const same = line?.oursOnPublished ?? null;
	return {
		published: figureWords(scoreOf(line, 'published'), figure),
		ours: same === null ? null : `${RECORD_BOX.ours} ${figureWords(same, figure)}`
	};
}

/** Whether the record draws the published projection: once a graded week carries it, so the season to
 * date does (Lane 82, the honest empty state: no column, no figure, no line before). The nightly names
 * Published in its method by the same rule (research/nightly/reads/record.py method). */
export function publishedDrawn(record: RunRecord): boolean {
	return record.toDate.some((line) => line.published !== null);
}

/** The orders the record draws, ours first: Published only once drawn. */
export function recordSources(record: RunRecord): readonly RecordSource[] {
	return publishedDrawn(record) ? RECORD_SOURCES : RECORD_SOURCES.filter((s) => s !== 'published');
}

/** The page's lead, naming only the orders drawn. */
export function recordLead(record: RunRecord, scoring: string): string {
	const beside = publishedDrawn(record) ? 'ADP and a published projection' : 'ADP';
	return `How the order we froze each week called its games, beside ${beside}, graded in ${scoring}`;
}

/** The published projection's basis from the week the register first keeps it: when it starts until a
 * graded week carries it, and from which week it counts once drawn. */
export function publishedWords(record: RunRecord): string {
	const from = record.publishedFromWeek;
	if (from !== null && publishedDrawn(record))
		return `Published is one provider's weekly projection, from week ${String(from)}.`;
	return from === null
		? "Published, one provider's weekly projection, starts once our register keeps it."
		: `Published, one provider's weekly projection, starts with week ${String(from)}.`;
}

/** A frozen board grades a player moved to a season-long list where it froze (the record's held-out
 * rule): no figure on the record reads the hourly capture, so its read time is not said here. */
export const HELD_OUT_METHOD =
	'A player moved to a season-long list is graded where the board froze.';

/** The record's basis, one paragraph's sentences: the run's method, the season-long rule, what the
 * starters figure counts (once a week is graded) and Published's start. */
export function recordBasis(record: RunRecord): string[] {
	return [record.method, HELD_OUT_METHOD, record.startersBasis, publishedWords(record)].filter(
		(text): text is string => text !== null && text !== ''
	);
}

/** The order a week graded, in the record's words (review 66j M7). */
export const ORDER_WORDS: Readonly<Record<NonNullable<RecordWeek['order']>, string>> = {
	preseason: 'Our preseason order',
	rest_of_season: 'Our rest-of-season order'
};

/** The orders the graded weeks graded, said once: "Our preseason order, weeks 1 to 2". */
export function gradedOrders(record: RunRecord): string {
	const graded = gradedWeeks(record);
	const orders = [...new Set(graded.map((w) => w.order).filter((o) => o !== null))];
	return orders
		.map((o, i) => (i === 0 ? ORDER_WORDS[o] : ORDER_WORDS[o].replace(/^Our/, 'our')))
		.join(', then ');
}

/** A point of the chart: a graded week's order matched. */
export interface ChartPoint {
	week: number;
	value: number;
}

/** One line per order drawn. */
export type ChartSeries = Partial<Record<RecordSource, ChartPoint[]>>;

/** The chart's series: each graded week's order matched for one position, in week order, for the
 * orders the record draws. */
export function chartSeries(record: RunRecord, position: RecordLine['position']): ChartSeries {
	const sources = recordSources(record);
	const graded = record.weeks.filter((week) => week.status === 'graded');
	return Object.fromEntries(
		sources.map((source) => [
			source,
			graded.flatMap((week) => {
				const value = scoreOf(
					week.lines.find((l) => l.position === position),
					source
				)?.agreement;
				return value === null || value === undefined ? [] : [{ week: week.week, value }];
			})
		])
	);
}

/** The chart's axis steps, a quarter apart. */
const AXIS_STEP = 0.25;

/** The chart's axis: 0.00 to 1.00 printed as the rates print, reaching a quarter lower for a week
 * below zero, so no week is drawn clamped (review 66j L12). */
export function chartTicks(values: readonly number[]): { value: number; label: string }[] {
	const bottom = Math.floor(Math.min(0, ...values) / AXIS_STEP);
	const top = Math.ceil(Math.max(1, ...values) / AXIS_STEP);
	return Array.from({ length: top - bottom + 1 }, (_, i) => {
		const value = (bottom + i) * AXIS_STEP;
		return { value, label: printPlaces(value, RATE_PLACES) };
	});
}
