/** The two records (Lane 114, the founder's ruling of 2026-10-21): the weekly record, our weekly
 * rankings against the weekly experts (ESPN's projection and the week's published projection, from
 * week 7), and the draft record, our draft board against ADP on the season's points so far. Each is
 * named by what it grades; ADP appears on the draft record alone. The weekly record is in the record's
 * own shape, so the page reads it with the record's functions (record.ts). */
import { dayLabel, weekdayLabel } from '#lib/format/date.ts';
import { plural } from '#lib/format/number.ts';
import type { BasisPart } from './board-basis.ts';
import {
	RATE_PLACES,
	RECORD_BOX,
	RECORD_WORDS,
	figureWords,
	printPlaces,
	publishedDrawn,
	publishedWords,
	saidOnly,
	weekLines,
	type LeagueBasis,
	type RecordFigure,
	type RecordSource,
	type WeekLine
} from './record.ts';
import type { DraftLine, DraftRecord, RecordLine, RecordWeek, RunRecord } from './schema.ts';

/** The records' words, in one place for the copy guard. */
export const RECORDS_WORDS = {
	lead: 'Two records, each graded against what it competes with: our weekly rankings against the weekly experts, and our draft board against ADP.',
	weekly: 'Weekly record',
	weeklyWhat: "Our weekly rankings against ESPN and the week's published projection",
	draft: 'Draft record',
	draftWhat: "Our draft board against ADP, on the season's points so far",
	/** The weeks before the weekly record, one line (ruling 1). */
	beforeLead: (from: number) => (from <= 2 ? 'Week 1' : `Weeks 1 to ${String(from - 1)}`),
	before: (from: number, set: string) =>
		`Weekly rankings start week ${String(from)} (${set}). Before that the site shipped the draft board, graded under Draft record.`,
	setBefore: (day: string) => `set before kickoff ${day}`,
	setOn: (day: string) => `set ${day}`,
	/** A first week with no date on file yet. */
	setUnknown: 'set before its first kickoff',
	espnBasis:
		"ESPN's is its own public projection in PPR, read before our order was set, on its players with an ESPN id.",
	yahooBasis: 'Yahoo publishes no player projection we can read, so it is not graded.',
	/** A run before Lane 114 carries neither record: said once, until the next run writes them. */
	waiting: 'This record is written by the next nightly run.',
	position: 'Position',
	players: 'Players graded',
	all: 'All',
	named: 'Top named',
	draftSpan: (through: number | null) =>
		through === null ? 'No week counted yet' : `Season points through week ${String(through)}`,
	draftPlayers: (n: number) => plural(n, 'player'),
	/** The draft record's basis, a sentence a part so a phone draws the figures' own (Lane 131). */
	draftSet: (set: string) =>
		`Our draft board is the preseason order we set ${set}, before the season's first kickoff, beside ADP as it stood then.`,
	draftGraded: (through: number | null) =>
		`${
			through === null
				? 'It is graded on the season points of the weeks played once the first week is complete'
				: `It is graded on each player's season points through week ${String(through)}`
		} in PPR, on the players both rank who have played.`,
	draftPositions: 'Each position is graded on its own, All by players graded.',
	draftBye: 'A player past his bye has one game fewer counted.',
	draftKickers: 'Kickers and defenses are left out: the board takes their order from ADP.',
	draftScale:
		'Order matched is how closely an order ranked the players as they finished the season so far: 1.00 is the same order, 0.00 no closer than chance, below it the reverse.',
	draftChart: 'Order matched, season to date, through each week',
	league: (host: string) => `Your ${host} league, as it scores`,
	rostered: 'Rostered',
	lineupOurs: 'Our picks',
	lineupEspn: "ESPN's picks",
	/** What the league row's figures are, at both widths (Lane 131 review MEDIUM-1, Lane 138). */
	leagueRow:
		"Your league's row grades its rostered players as it scores, and the lineup each picks.",
	frontWeekly: (span: string, players: string, beside: string) =>
		`Order matched, our weekly rankings over ${span}, ${players}.${beside}`,
	frontDraft: (rate: string, through: number, players: string) =>
		`Order matched, our draft board through week ${String(through)}, ${players}. ADP ${rate}.`,
	frontDraftNamed: (ours: string, adp: string) => `Top named ${ours}, ADP ${adp}.`,
	frontStarters: (ours: string, beside: string) => `Starters right ${ours}${beside}.`,
	frontWeeklyNext: (week: number) => `Weekly rankings start week ${String(week)}.`,
	/** The weekly record's upcoming weeks (fix round 1, M4): the next one on its own line, the rest
	 * said once. */
	setEach: 'set each week before kickoff',
	/** The order a set week of the weekly record graded (M2): never "rest-of-season". */
	weeklyOrder: (day: string) => `Our weekly rankings, set ${day}`,
	/** The weekly record before its first week is set. */
	opening: (week: number) => `Week ${String(week)}`,
	openingCaption: (set: string) => `Our first weekly rankings, ${set}.`
} as const;

/** The weekly record's figure before any week of it is set: its first week and when it is set; null
 * once a week is set (the record's own headline then says how many are graded). */
export function weeklyOpening(
	record: RunRecord,
	fromWeek: number
): { value: string; caption: string } | null {
	if (record.weeks.some((week) => week.status === 'graded' || week.status === 'frozen'))
		return null;
	const first = record.weeks.find((week) => week.week === fromWeek);
	const at = first?.frozenAt ?? null;
	const set = at === null ? RECORDS_WORDS.setUnknown : RECORDS_WORDS.setBefore(weekdayLabel(at));
	return { value: RECORDS_WORDS.opening(fromWeek), caption: RECORDS_WORDS.openingCaption(set) };
}

/** The weekly record as a record the record's functions read, or null on a run before Lane 114. The
 * published projection's first week is the first graded week whose lines carry it. */
export function weeklyAsRecord(run: RunRecord): RunRecord | null {
	const weekly = run.weekly;
	if (weekly === undefined) return null;
	const published = weekly.weeks.find(
		(week) => week.status === 'graded' && week.lines.some((line) => line.published !== null)
	);
	return {
		season: run.season,
		format: run.format,
		statistic: weekly.statistic,
		scale: weekly.scale,
		startersBasis: weekly.startersBasis,
		method: weekly.method,
		publishedFromWeek: published?.week ?? null,
		honest: weekly.honest,
		weeks: weekly.weeks,
		toDate: weekly.toDate
	};
}

/** The weeks before the weekly record, as one line: "Weeks 1 to 6" and "Weekly rankings start week 7
 * (set before kickoff Thu Oct 22). Before that the site shipped the draft board, graded under Draft
 * record." Null when the record starts at week 1. */
export function beforeLine(
	fromWeek: number,
	first: RecordWeek | undefined
): { lead: string; text: string } | null {
	if (fromWeek <= 1) return null;
	const at = first?.frozenAt ?? null;
	const set =
		at === null
			? RECORDS_WORDS.setUnknown
			: first?.status === 'upcoming'
				? RECORDS_WORDS.setBefore(weekdayLabel(at))
				: RECORDS_WORDS.setOn(weekdayLabel(at));
	return { lead: RECORDS_WORDS.beforeLead(fromWeek), text: RECORDS_WORDS.before(fromWeek, set) };
}

/** A sentence drawn at both widths, and one a desk alone draws: a phone holds eight lines of basis,
 * the figures' own sentences (Lane 131). */
const both = (text: string): BasisPart => ({ text, phone: true });
const deskOnly = (text: string): BasisPart => ({ text, phone: false });

/** The weekly record's basis (Lanes 131, 138). Both widths say what each figure is: order matched,
 * places off, starters right in the lineup it counts, and, opened from a league, what the league row's
 * figures are. A desk also says what ESPN's projection is once drawn, when the published projection's
 * column starts once drawn, and Yahoo's absence. The rest are qualifications other parts of the page
 * say, so the desk holds five lines (Lane 138): how the rankings are set (the week table's lines), the
 * season-long rule, what the league's lineup leaves uncounted (its starters sentence names the lineup
 * it counts), and the published projection's start before it is drawn (the section's head names it). */
export function weeklyBasis(
	record: RunRecord,
	league: LeagueBasis | null,
	espnDrawn: boolean
): BasisPart[] {
	return [
		...saidOnly([
			record.scale,
			RECORD_WORDS.placesOff,
			league?.starters ?? record.startersBasis,
			league?.benchmark ? RECORDS_WORDS.leagueRow : null
		]).map(both),
		...saidOnly([
			espnDrawn ? RECORDS_WORDS.espnBasis : null,
			publishedDrawn(record) ? publishedWords(record) : null,
			RECORDS_WORDS.yahooBasis
		]).map(deskOnly)
	];
}

/** "Week 7", "Weeks 8 to 18". */
function spanLead(weeks: readonly RecordWeek[]): string {
	const first = weeks.at(0)?.week ?? 0;
	const last = weeks.at(-1)?.week ?? first;
	return first === last ? `Week ${String(first)}` : `Weeks ${String(first)} to ${String(last)}`;
}

/** The weekly record's week lines (fix round 1, M4): the record's own for the set and missed weeks;
 * of the weeks to come, the next to set on its own line with its kickoff day ("Week 7", "set before
 * kickoff Thu Oct 22") and the rest once ("Weeks 8 to 18", "set each week before kickoff"), so no line
 * reads as many weeks set on one day. */
export function weeklyLines(weeks: readonly RecordWeek[], unplayed: readonly number[]): WeekLine[] {
	const coming = weeks.filter((week) => week.status === 'upcoming');
	const lines = weekLines(
		weeks.filter((week) => week.status !== 'upcoming'),
		unplayed
	);
	const [next, ...rest] = coming;
	if (next === undefined) return lines;
	const nextLine: WeekLine = {
		lead: spanLead([next]),
		text:
			next.frozenAt === null
				? RECORDS_WORDS.setUnknown
				: RECORDS_WORDS.setBefore(weekdayLabel(next.frozenAt)),
		week: null
	};
	const restLine: WeekLine[] =
		rest.length === 0 ? [] : [{ lead: spanLead(rest), text: RECORDS_WORDS.setEach, week: null }];
	return [...lines, nextLine, ...restLine];
}

/** The weekly record's head in its bug (M2): the weeks it has graded, "Week 7", "Weeks 7 to 9". */
export function weeklySpan(record: RunRecord): string {
	return spanLead(record.weeks.filter((week) => week.status === 'graded'));
}

/** A set week's order on the weekly record (M2): "Our weekly rankings, set Oct 22". */
export function weeklyOrderWords(week: RecordWeek): string | null {
	return week.frozenAt === null || week.order === null
		? null
		: RECORDS_WORDS.weeklyOrder(dayLabel(week.frozenAt));
}

/** The draft record's orders, ours first. */
export const DRAFT_SOURCES = ['ours', 'adp'] as const satisfies readonly RecordSource[];

/** The draft record's figures: order matched, places off, top named. */
export const DRAFT_FIGURES = [
	'agreement',
	'placesOff',
	'starters'
] as const satisfies readonly RecordFigure[];

/** The figures' heads on the draft record: top named in place of starters right. */
export function draftHeads(run: RunRecord): Readonly<Record<RecordFigure, string>> {
	return {
		agreement: run.statistic.agreement,
		placesOff: run.statistic.placesOff,
		starters: RECORDS_WORDS.named
	};
}

/** The draft table's rows: each position, then All as the totals row. */
export function draftRows(draft: DraftRecord): { positions: DraftLine[]; all: DraftLine | null } {
	return {
		positions: draft.lines.filter((line) => line.position !== 'All'),
		all: draft.lines.find((line) => line.position === 'All') ?? null
	};
}

/** A draft line's figure for an order, as its cell prints it. */
export function draftCell(
	line: DraftLine,
	source: (typeof DRAFT_SOURCES)[number],
	figure: RecordFigure
): string {
	return figureWords(line[source], figure);
}

/** The draft record's chart: order matched for each order through each counted week, the record
 * chart's series shape. */
export function draftSeries(
	draft: DraftRecord
): Partial<Record<RecordSource, { week: number; value: number }[]>> {
	const of = (source: 'ours' | 'adp'): { week: number; value: number }[] =>
		draft.progress.flatMap((point) => {
			const value = point[source];
			return value === null ? [] : [{ week: point.week, value }];
		});
	return { ours: of('ours'), adp: of('adp') };
}

/** The draft record's basis (Lane 131). A desk says when the board was set and what it is graded on
 * (the section's head and the bug say both on a phone), the bye and the kickers left out; both widths
 * say how All combines the positions and what each figure is: order matched, places off and top
 * named. */
export function draftBasis(draft: DraftRecord): BasisPart[] {
	return [
		...[
			RECORDS_WORDS.draftSet(weekdayLabel(draft.setAt)),
			RECORDS_WORDS.draftGraded(draft.throughWeek),
			RECORDS_WORDS.draftBye,
			RECORDS_WORDS.draftKickers
		].map(deskOnly),
		...saidOnly([
			RECORDS_WORDS.draftPositions,
			RECORDS_WORDS.draftScale,
			RECORD_WORDS.placesOff,
			draft.namedBasis
		]).map(both)
	];
}

/** The front door's record card (ruling 4): the weekly record once a week of it is graded, the
 * draft record until then, named either way. */
export interface FrontRecord {
	name: string;
	value: string;
	caption: string;
	/** The order matched scale, said under the figure (M4). */
	scale: string;
	second: string | null;
	note: string | null;
}

function rate(value: number | null): string {
	return value === null ? RECORD_BOX.none : printPlaces(value, RATE_PLACES);
}

/** Each yardstick drawn beside ours on a weekly line, as ". ESPN 0.58. Published 0.55". */
function besideWords(line: RecordLine, figure: RecordFigure): string {
	const named = (['espn', 'published'] as const).flatMap((source) =>
		line[source] === null ? [] : [`${RECORD_BOX[source]} ${figureWords(line[source], figure)}`]
	);
	return named.length === 0 ? '' : `, ${named.join(', ')}`;
}

function weeklyFront(weekly: RunRecord): FrontRecord | null {
	const graded = weekly.weeks.filter((week) => week.status === 'graded');
	const all = weekly.toDate.find((line) => line.position === 'All');
	if (graded.length === 0 || all === undefined || all.ours.agreement === null) return null;
	const first = graded[0]?.week ?? 0;
	const last = graded.at(-1)?.week ?? first;
	const span =
		first === last ? `week ${String(first)}` : `weeks ${String(first)} to ${String(last)}`;
	const beside = besideWords(all, 'agreement');
	return {
		name: RECORDS_WORDS.weekly,
		value: rate(all.ours.agreement),
		scale: weekly.scale,
		caption: RECORDS_WORDS.frontWeekly(
			span,
			plural(all.ours.graded, 'player'),
			beside === '' ? '' : ` ${beside.slice(2)}.`
		),
		second:
			all.ours.startersOf === 0
				? null
				: RECORDS_WORDS.frontStarters(
						figureWords(all.ours, 'starters'),
						besideWords(all, 'starters')
					),
		note: null
	};
}

function draftFront(
	draft: DraftRecord,
	weekly: RunRecord | null,
	fromWeek: number | null
): FrontRecord | null {
	const all = draft.lines.find((line) => line.position === 'All');
	if (all === undefined || all.ours.agreement === null || draft.throughWeek === null) return null;
	return {
		name: RECORDS_WORDS.draft,
		value: rate(all.ours.agreement),
		scale: RECORDS_WORDS.draftScale,
		caption: RECORDS_WORDS.frontDraft(
			rate(all.adp.agreement),
			draft.throughWeek,
			plural(all.ours.graded, 'player')
		),
		second:
			all.ours.startersOf === 0
				? null
				: RECORDS_WORDS.frontDraftNamed(
						figureWords(all.ours, 'starters'),
						String(all.adp.starters)
					),
		note: weekly === null || fromWeek === null ? null : RECORDS_WORDS.frontWeeklyNext(fromWeek)
	};
}

/** The front card from a run: null on a run before Lane 114, which keeps the card as it was. */
export function frontRecord(run: RunRecord): FrontRecord | null {
	const weekly = weeklyAsRecord(run);
	const fromWeekly = weekly === null ? null : weeklyFront(weekly);
	if (fromWeekly !== null) return fromWeekly;
	return run.draft === undefined
		? null
		: draftFront(run.draft, weekly, run.weekly?.fromWeek ?? null);
}
