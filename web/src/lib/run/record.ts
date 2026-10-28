/** The record in the words a page prints: its one big number and each week as a person says it.
 * The record page and the front door both read these, so the headline is said one way. Lane 93: we
 * "set" the order before kickoff (never "froze" it), the headline says how many played weeks are
 * graded beside the figure and why the rest are not, and the measures are defined once, in a
 * player's words, in the basis. */
import { EMPTY_FIGURE } from '#lib/format/empty.ts';
import { dayLabel, weekdayLabel, weekdayWord } from '#lib/format/date.ts';
import { plural } from '#lib/format/number.ts';
import type { RecordLine, RecordWeek, RunRecord, Score } from './schema.ts';

/** The record's one number and its caption. */
export interface RecordHeadline {
	value: string;
	caption: string;
	/** True once a week is graded and the number is our agreement with the finish. */
	graded: boolean;
	/** Starters right beside it once graded, ours then ADP's (Lane 93, B03: never only the figure we
	 * lead on): "100 of 168", "ADP 104 of 168". Null before a week is graded. */
	starters: { value: string; caption: string } | null;
	/** "Graded 2 of 5 weeks played", once a week is played. */
	standing: string | null;
	/** Why the played weeks not graded are not, in plain words, empty when every one is. */
	gaps: string;
}

/** A phrase with its first letter capital. */
export function capitalized(words: string): string {
	return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** A pooled line for every position, the one the headline and each week's line lead with. */
export function allLine(lines: readonly RecordLine[]): RecordLine | undefined {
	return lines.find((line) => line.position === 'All');
}

function gradedWeeks(record: RunRecord): RecordWeek[] {
	return record.weeks.filter((week) => week.status === 'graded');
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

/** A rate (order matched) prints the run's two decimals, the one figure not to a tenth (ruling R2). */
export const RATE_PLACES = 2;

const GRADES_RULE = "grades once every game's stats are in";
const USUALLY = 'usually';

/** "grades once every game's stats are in, usually Wednesday", the rule alone with no day. */
export function gradesWhen(day: string | null): string {
	return day === null ? GRADES_RULE : `${GRADES_RULE}, ${USUALLY} ${day}`;
}

/** The record's words, in one place for the copy guard (Lane 93). */
export const RECORD_WORDS = {
	/** Places off in a player's words, its meaning whole, said once in the basis (B04, Lane 131). */
	placesOff: 'Places off is how many places a player finished from his rank, lower is better.',
	/** The weeks no order was set for: never graded after the fact (B03). */
	missedOne: (week: string) => `${week} was not set before kickoff, so it cannot be graded.`,
	missedMany: (weeks: string) => `${weeks} were not set before kickoff, so they cannot be graded.`,
	/** A set week's game state beside its set time (D08): the schedule's, never the run's. */
	notPlayed: 'not played yet',
	underway: 'under way',
	/** The grading rule a set week waits on (B254): a week grades once every game's stats are in,
	 * so a page says the rule and, beside it, the day it usually holds (the run's gradesFrom). */
	gradesRule: GRADES_RULE,
	usually: USUALLY,
	/** A set week whose games are played and whose stats have not landed. */
	waiting: (week: string, day: string | null) => `${week} ${gradesWhen(day)}.`,
	standing: (graded: number, played: number) =>
		`Graded ${String(graded)} of ${plural(played, 'week')} played`,
	noneSet: 'weeks graded. Our first order is set before the first kickoff',
	ofSet: (frozen: number) => `of ${plural(frozen, 'week')} set graded`,
	/** The front card's second figure (B03). */
	frontStarters: (adp: string) => `Starters right, ours over the same weeks. ${adp}.`
} as const;

/** The played weeks and how many of them are graded: a week is played once its stats are in or its
 * kickoff passed with no order set; a set week waiting on its stats is said on its own (gapWords). */
export function gradedOfPlayed(record: RunRecord): { graded: number; played: number } {
	const graded = gradedWeeks(record).length;
	const missed = record.weeks.filter((week) => week.status === 'missed').length;
	return { graded, played: graded + missed };
}

/** "Graded 2 of 5 weeks played", null before any week is played. */
export function standingWords(record: RunRecord): string | null {
	const { graded, played } = gradedOfPlayed(record);
	return played === 0 ? null : RECORD_WORDS.standing(graded, played);
}

/** Every run of weeks with the same status, in order. */
function runsOf(weeks: readonly RecordWeek[]): RecordWeek[][] {
	const runs: RecordWeek[][] = [];
	for (const week of weeks) {
		const last = runs.at(-1);
		if (last !== undefined && joins(last, week)) runs[runs.length - 1] = [...last, week];
		else runs.push([week]);
	}
	return runs;
}

/** Why the played weeks not graded are not: "Weeks 3 to 5 were not set before kickoff, so they
 * cannot be graded. Week 6 grades once every game's stats are in, usually Wednesday." `unplayed` names the set weeks not
 * played yet, which wait on nothing. `whenWeek` is the week a drawn "when" line already says the rule
 * for (B260): its waiting sentence is dropped, so the rule is said once. */
export function gapWords(
	record: RunRecord,
	unplayed: readonly number[] = [],
	whenWeek: number | null = null
): string {
	const missed = runsOf(record.weeks)
		.filter((run) => run[0]?.status === 'missed')
		.map((run) =>
			run.length === 1 ? RECORD_WORDS.missedOne(lead(run)) : RECORD_WORDS.missedMany(lead(run))
		);
	const waiting = record.weeks
		.filter(
			(week) => week.status === 'frozen' && !unplayed.includes(week.week) && week.week !== whenWeek
		)
		.map((week) =>
			RECORD_WORDS.waiting(
				lead([week]),
				week.gradesFrom === undefined ? null : weekdayWord(week.gradesFrom)
			)
		);
	return [...missed, ...waiting].join(' ');
}

/** Starters right to date beside the headline: ours, and ADP's on the same players. */
function startersBeside(line: RecordLine): RecordHeadline['starters'] {
	if (line.ours.startersOf === 0) return null;
	return {
		value: figureWords(line.ours, 'starters'),
		caption: `${RECORD_BOX.adp} ${figureWords(line.adp, 'starters')}`
	};
}

/** The first yardstick a line draws beside ours, in page order (ADP, ESPN, then Published), and its
 * score: the one a headline names. */
function firstBeside(line: RecordLine): { source: RecordSource; score: Score } | null {
	for (const source of RECORD_SOURCES) {
		const score = source === 'ours' ? null : line[source];
		if (score !== null) return { source, score };
	}
	return null;
}

/** Graded: our rank agreement with the finish over every graded week, the span and the players it
 * counts, ADP's beside it, starters right beside both, and how many played weeks are graded. Not yet:
 * how many of the set weeks are graded. */
export function recordHeadline(
	record: RunRecord,
	unplayed: readonly number[] = []
): RecordHeadline {
	const graded = gradedWeeks(record);
	const overall = allLine(record.toDate);
	const agreement = overall?.ours.agreement;
	const standing = standingWords(record);
	const gaps = gapWords(record, unplayed);
	if (overall && agreement !== null && agreement !== undefined && graded.length > 0) {
		const beside = firstBeside(overall);
		const rate = beside?.score.agreement ?? null;
		const adpPart =
			beside === null || rate === null
				? ''
				: `. ${RECORD_BOX[beside.source]} ${printPlaces(rate, RATE_PLACES)} on the same players`;
		return {
			value: printPlaces(agreement, RATE_PLACES),
			caption: `${capitalized(rankAgreement(record))}, ours over ${weekSpan(graded)} and ${plural(overall.ours.graded, 'player')}${adpPart}.`,
			graded: true,
			starters: startersBeside(overall),
			standing,
			gaps
		};
	}
	const set = record.weeks.filter((w) => w.status === 'graded' || w.status === 'frozen').length;
	return {
		value: String(graded.length),
		caption: set === 0 ? RECORD_WORDS.noneSet : RECORD_WORDS.ofSet(set),
		graded: false,
		starters: null,
		standing,
		gaps
	};
}

/** A time the schema guarantees for the status, read without a fallback that could print. */
function stamp(iso: string | null, week: RecordWeek): string {
	if (iso === null) throw new Error(`Week ${String(week.week)} is ${week.status} with no date.`);
	return weekdayLabel(iso);
}

/** One line of the week list: a week, or a run of missed or upcoming weeks said once. */
export interface WeekLine {
	/** "Week 1", "Weeks 3 to 5". */
	lead: string;
	/** "set Tue Sep 8, graded Wed Oct 14", "our order was not set before kickoff, so it cannot be
	 * graded", "set before kickoff Thu Oct 22": set first, then graded, one order every week (B37). */
	text: string;
	/** The week a graded or frozen line speaks for, so a page can add its figures. Null for a run. */
	week: RecordWeek | null;
}

/** "Week 1", "Weeks 3 to 5". */
function lead(weeks: readonly RecordWeek[]): string {
	return capitalized(weekSpan(weeks));
}

/** A set week as a person says it: "set Tue Sep 8, graded Wed Oct 14", "set Thu Oct 22, not played
 * yet" before its first kickoff, "set Tue Oct 13, grades once every game's stats are in, usually Wed
 * Oct 21" after it. */
function frozenWords(
	week: RecordWeek,
	unplayed: readonly number[],
	underway: readonly number[]
): string {
	const set = `set ${stamp(week.frozenAt, week)}`;
	if (week.status === 'graded') return `${set}, graded ${stamp(week.gradedAt, week)}`;
	if (unplayed.includes(week.week)) return `${set}, ${RECORD_WORDS.notPlayed}`;
	if (underway.includes(week.week)) return `${set}, ${RECORD_WORDS.underway}`;
	return `${set}, ${gradesWhen(week.gradesFrom === undefined ? null : weekdayLabel(week.gradesFrom))}`;
}

/** A missed week's reason as a clause: the run's note ("Our order was not set before kickoff that
 * week.") with its full stop and its "that week" dropped. The run must say why a week was missed: the
 * record never hides a gap. */
function reason(week: RecordWeek): string {
	if (week.note === undefined) throw new Error(`Week ${String(week.week)} is missed with no note.`);
	const clause = week.note.replace(/\.$/, '').replace(/ that week$/, '');
	return `${clause.charAt(0).toLowerCase()}${clause.slice(1)}`;
}

/** A run of weeks said once: missed ones with why, or what is left with the day the next order is
 * set by, from the schedule. */
function runWords(run: readonly RecordWeek[]): string {
	const [first] = run;
	if (first === undefined) throw new Error('A run of weeks is never empty.');
	if (first.status === 'missed')
		return `${reason(first)}, so ${run.length === 1 ? 'it' : 'they'} cannot be graded`;
	return first.frozenAt === null
		? 'our first order is set before its first kickoff'
		: `set before kickoff ${weekdayLabel(first.frozenAt)}`;
}

/** Whether a week joins the run before it: the same status, missed or upcoming, and for missed weeks
 * the same reason, so two causes never share a line. */
function joins(run: readonly RecordWeek[] | undefined, week: RecordWeek): boolean {
	const first = run?.[0];
	if (first?.status !== week.status) return false;
	if (week.status === 'missed') return reason(first) === reason(week);
	return week.status === 'upcoming';
}

/** The season week by week, each run of missed weeks one line ("Weeks 3 to 5, our order was not set
 * before kickoff, so they cannot be graded") and every week still to come one line ("Weeks 7 to 18,
 * set before kickoff Thu Oct 22"), so the list says what happened and what is next rather than logging
 * each week alike. `unplayed` names the set weeks whose first kickoff is still ahead, `underway` those with a game not final. */
export function weekLines(
	weeks: readonly RecordWeek[],
	unplayed: readonly number[] = [],
	underway: readonly number[] = []
): WeekLine[] {
	return runsOf(weeks).map((run) => {
		const [first] = run;
		if (first === undefined) throw new Error('A run of weeks is never empty.');
		const grouped = first.status === 'missed' || first.status === 'upcoming';
		return grouped
			? { lead: lead(run), text: runWords(run), week: null }
			: { lead: lead(run), text: frozenWords(first, unplayed, underway), week: first };
	});
}

/** The orders a record row compares, ours first: ADP on the legacy and draft records, ESPN's and the
 * published projection on the weekly record (Lane 114). */
export const RECORD_SOURCES = ['ours', 'adp', 'espn', 'published'] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];

/** The three figures a record row gives each order (Lane 66j). */
export const RECORD_FIGURES = ['agreement', 'placesOff', 'starters'] as const;
export type RecordFigure = (typeof RECORD_FIGURES)[number];

/** The record box score's words, in one place for the copy guard. */
export const RECORD_BOX = {
	week: 'Week',
	players: 'Players graded',
	/** The to-date row's player count: every player any graded week counted, once (B04). */
	distinct: (n: number) => `${String(n)} distinct`,
	status: 'Status',
	ours: 'Ours',
	adp: 'ADP',
	espn: 'ESPN',
	published: 'Published',
	toDate: 'To date',
	none: EMPTY_FIGURE,
	chart: 'Order matched by week',
	/** The league's own weeks, our picks from the member's roster against its benchmark's (ruling 6). */
	league: 'Your lineup, our picks',
	/** "2 weeks graded", beside the chart's head (B45). */
	chartWeeks: (n: number) => `${plural(n, 'week')} graded`
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

/** The season to date's ours pooled again over the weeks that graded a yardstick, its name on a line. */
const OURS_ON: Readonly<Partial<Record<RecordSource, 'oursOnPublished' | 'oursOnEspn'>>> = {
	published: 'oursOnPublished',
	espn: 'oursOnEspn'
};

/** A yardstick's figure with ours over the same weeks beside it (review 66j N1): the run pools ours
 * again over the weeks that graded the published projection or ESPN's, so the two compare like with
 * like. `ours` is null on a week's line, where both are graded on the same rows already, and for ADP,
 * graded every week ours is. */
export function besideOf(
	line: RecordLine | undefined,
	source: RecordSource,
	figure: RecordFigure
): { value: string; ours: string | null } {
	const key = OURS_ON[source];
	const same = key === undefined ? null : (line?.[key] ?? null);
	return {
		value: figureWords(scoreOf(line, source), figure),
		ours: same === null ? null : `${RECORD_BOX.ours} ${figureWords(same, figure)}`
	};
}

/** Whether the record draws an order: ours always; a yardstick once a graded week carries it, so the
 * season to date does (Lane 82, the honest empty state: no column, no figure, no line before). The
 * nightly names a yardstick in its method by the same rule (research/nightly/reads/record.py method,
 * weekly_record.py drawn). */
export function sourceDrawn(record: RunRecord, source: RecordSource): boolean {
	return source === 'ours' || record.toDate.some((line) => line[source] !== null);
}

/** Whether the record draws the published projection. */
export function publishedDrawn(record: RunRecord): boolean {
	return sourceDrawn(record, 'published');
}

/** The orders the record draws, ours first. */
export function recordSources(record: RunRecord): readonly RecordSource[] {
	return RECORD_SOURCES.filter((source) => sourceDrawn(record, source));
}

/** The page's lead, naming only the orders drawn. */
export function recordLead(record: RunRecord, scoring: string): string {
	const beside = publishedDrawn(record) ? "ADP and the week's published projection" : 'ADP';
	return `How the order we set before each week's kickoff called its games, beside ${beside}, graded in ${scoring}`;
}

/** The first week the published projection is graded from: the register's first week that kept it,
 * null while no set order has (review M3). */
export function publishedFrom(record: RunRecord): number | null {
	return record.publishedFromWeek;
}

/** The published projection's basis as a plain rule (B04, review M3, Lane 140 C16): the week it
 * starts, named only once a set order has kept it, "From week 7 the week's published projection
 * (Published) is graded beside ours on the same players."; before that the rule with no week in it,
 * never a promise renewed each week. */
export function publishedWords(record: RunRecord): string {
	const from = publishedFrom(record);
	if (from === null)
		return "The week's published projection is graded beside ours from the first week we read it before setting our order.";
	const named = publishedDrawn(record) ? ' (Published)' : '';
	return `From week ${String(from)} the week's published projection${named} is graded beside ours on the same players.`;
}

/** What a page opened from a league says in the record's basis in place of the run's own: what the
 * starters figure counts in the league's lineup, and the league's own benchmark. */
export interface LeagueBasis {
	starters: string | null;
	benchmark: string | null;
}

/** A basis's sentences, the empty ones left out. */
export function saidOnly(texts: readonly (string | null)[]): string[] {
	return texts.filter((text): text is string => text !== null && text !== '');
}

/** A run's own record's basis, before Lane 114, every sentence drawn at both widths and held to a
 * phone's eight lines (Lane 131): the run's method, each measure in a player's words (order matched,
 * places off, starters right in the lineup it counts). A league's own sentences replace the starters
 * one and follow. The season-long rule and the published projection's start are qualifications it
 * leaves out; the page's lead names the week's published projection once its
 * column is drawn (recordLead), so the basis does not. */
export function recordBasis(record: RunRecord, league: LeagueBasis | null = null): string[] {
	return saidOnly([
		record.method,
		record.scale,
		RECORD_WORDS.placesOff,
		league?.starters ?? record.startersBasis,
		league?.benchmark ?? null
	]);
}

/** The order a week graded, in the record's words (review 66j M7). */
export const ORDER_WORDS: Readonly<Record<NonNullable<RecordWeek['order']>, string>> = {
	preseason: 'Our preseason order',
	rest_of_season: 'Our rest-of-season order'
};

/** The order a week graded with its refresh, as every screen names it (B18): "Our rest-of-season
 * order, refreshed Oct 22", "Our preseason order". */
export function weekOrderWords(week: RecordWeek): string | null {
	if (week.order === null) return null;
	const named = ORDER_WORDS[week.order];
	return week.order === 'rest_of_season' && week.orderAsOf !== undefined
		? `${named}, refreshed ${dayLabel(week.orderAsOf)}`
		: named;
}

/** The orders the graded weeks graded, said once: "Our preseason order, then our rest-of-season
 * order". */
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
	const graded = gradedWeeks(record);
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

/** The chart's axis: the graded weeks alone, in order (B45), never the season's empty weeks. */
export function chartWeeks(record: RunRecord): number[] {
	return gradedWeeks(record).map((week) => week.week);
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
