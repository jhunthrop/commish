/** The two records (Lane 114, the founder's ruling of 2026-10-21): the weekly record, our
 * rest-of-season order graded week by week against ESPN and the week's published projection (from
 * week 7; Lane 223, B188: the order graded is the one the site ships, never a weekly model), and the
 * draft record,
 * our draft board against ADP on the season's points so far. Each is named by what it grades; ADP appears on the draft record alone. The weekly record is in the record's
 * own shape, so the page reads it with the record's functions (record.ts). */
import { BUILD_ZONE, dayTimeStamp } from '#lib/format/day-time.ts';
import { dayLabel, weekdayLabel, weekdayWord } from '#lib/format/date.ts';
import { plural } from '#lib/format/number.ts';
import type { BasisPart } from './board-basis.ts';
import { figurePair, type FigurePair } from './record-pair.ts';
import {
	RECORD_BOX,
	RECORD_WORDS,
	figureWords,
	publishedDrawn,
	publishedWords,
	saidOnly,
	weekLines,
	capitalized,
	gradesWhen,
	type LeagueBasis,
	type RecordFigure,
	type RecordSource,
	type WeekLine
} from './record.ts';
import type { DraftLine, DraftRecord, RecordLine, RecordWeek, RunRecord } from './schema.ts';

/** The weekly record's yardsticks, one name everywhere on the page (Lane 140, C15). */
const YARDSTICKS = "ESPN and the week's published projection";

/** The draft record's name, one source for every sentence that names it (review L2). */
const DRAFT_RECORD = 'Draft record';

/** The records' words, in one place for the copy guard. */
export const RECORDS_WORDS = {
	lead: `Two records, each graded against what it competes with: our rest-of-season order, graded week by week against ${YARDSTICKS}, and our draft board against ADP.`,
	weekly: 'Weekly record',
	weeklyWhat: `Our rest-of-season order, graded week by week against ${YARDSTICKS}`,
	draft: DRAFT_RECORD,
	draftWhat: "Our draft board against ADP, on the season's points so far",
	/** The weeks before the weekly record, one line (ruling 1). */
	beforeLead: (from: number) => (from <= 2 ? 'Week 1' : `Weeks 1 to ${String(from - 1)}`),
	/** The set rule, said once (Lane 140, C14): each week's own set time is on its row. */
	before: (from: number) =>
		`Our rest-of-season order is graded week by week from week ${String(from)}. Each week's order is set before its first kickoff and graded as set, never as refreshed after, so a player put on IR later keeps the rank we set. Before that the site shipped the draft board, graded under ${DRAFT_RECORD}.`,
	/** The weeks before the weekly record on a phone (Lane 209): a chip a week, "Wk 1", then where
	 * they are graded, in place of the set rule's paragraph, which a desk says. */
	beforeChip: (week: number) => `Wk ${String(week)}`,
	beforePhone: `Graded under ${DRAFT_RECORD}`,
	/** The set rule's short form under the chips, so a phone says it once too (review M3). */
	setRulePhone: "Each week's order is graded as set, never as refreshed after.",
	setBefore: (day: string) => `set before kickoff ${day}`,
	/** A set week's row, its set time to the minute and its zone (C14). */
	setAt: (stamp: string) => `set ${stamp}`,
	notPlayed: RECORD_WORDS.notPlayed,
	underway: RECORD_WORDS.underway,
	gradedOn: (day: string) => `graded ${day}`,
	/** The run's day is the first pass that can grade once every game's stats are in (B254), so
	 * the rule first and the day as the usual one. */
	gradesOn: (day: string) => gradesWhen(day),
	gradesLater: RECORD_WORDS.gradesRule,
	/** The weekly record's bug before a week of it is graded (C04): no figure, the week and when. */
	pending: (week: number) => `Week ${String(week)} not graded yet`,
	pendingWhen: (day: string | null, game: string | null) =>
		day === null && game !== null
			? `${capitalized(RECORD_WORDS.gradesRule)}, after ${game}'s game.`
			: `${capitalized(gradesWhen(day))}.`,
	/** A first week with no date on file yet. */
	setUnknown: 'set before its first kickoff',
	/** ESPN's projection in one line at a desk (Lane 163, D07): the season-long rule (C16) is said in
	 * the set rule's line (before) and a week whose ESPN read came after the set under its own row
	 * (Lane 147). */
	espnBasis: "ESPN's is its own public PPR projection, read before the week's first kickoff.",
	/** The weekly run's yardstick sentences (Lanes 146 and 148, research/nightly/reads/weekly_record.py), here
	 * for the copy guard and the stand-in run only: the page prints a week's espnNote as the run wrote
	 * it, never these. */
	espnReadAfter:
		"ESPN's projection this week was read after our rest-of-season order was set, still before the first kickoff.",
	espnUnread:
		"ESPN's projection was not read before this week's first kickoff, so the week is graded against the week's published projection alone.",
	noYardstick:
		"No yardstick was read before this week's first kickoff, so the week is graded on its own order alone.",
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
	draftSet: (set: string, through: number | null) =>
		`Our draft board is the preseason order we set ${set}, graded on ${
			through === null
				? 'the season points of the weeks played once the first week is complete'
				: `each player's season points through week ${String(through)}`
		} in PPR, on the players both rank who have played.`,
	draftPositions: 'Each position is graded on its own, All by players graded.',
	draftLeftOut:
		'Kickers and defenses are left out, and a player past his bye has one game fewer counted.',
	draftScale:
		"Order matched is how closely an order ranked the players to the season's finish so far: 1.00 is the same order, 0.00 no closer than chance, below 0.00 the order runs backwards.",
	/** Under the places off tile (C17). */
	lowerBetter: 'lower is better',
	/** Under the top named tile: what the tops are (C17). */
	namedKey: (tops: string) => `of the top ${tops}`,
	draftChart: 'Order matched, season to date, through each week',
	league: (host: string) => `Your ${host} league, as it scores`,
	rostered: 'Rostered',
	lineupOurs: 'Our picks',
	lineupEspn: "ESPN's picks",
	/** What the league row's figures are, at both widths (Lane 131 review MEDIUM-1, Lane 138). */
	leagueRow: "Your league's row grades its rostered players and both lineups.",
	frontWeekly: (span: string, players: string) =>
		`Our rest-of-season order, graded over ${span}, ${players}.`,
	frontDraft: (through: number, players: string) =>
		`Our draft board through week ${String(through)}, ${players}.`,
	/** Before a yardstick is graded, what the weekly card will compare against (Lane 142). */
	frontWeeklyNext: (week: number) =>
		`Our rest-of-season order is graded week by week from week ${String(week)}, against ${YARDSTICKS}.`,
	/** The weekly record's upcoming weeks (fix round 1, M4): the next one on its own line, the rest
	 * said once. */
	setEach: 'set each week before kickoff',
	/** The order a set week of the weekly record graded: the rest-of-season order the site shipped
	 * (Lane 223, B188, superseding Lane 114's M2 now no weekly model has passed its check). */
	weeklyOrder: (day: string) => `Our rest-of-season order, set ${day}`
} as const;

/** The weekly record's next week to grade and its schedule, as the page loader reads it from the
 * run's schedule: the week's last kickoff. */
export interface NextGrade {
	week: number;
	/** The week's last kickoff, null when the schedule names none. */
	lastKickoff: string | null;
}

/** The weekly record's bug before any week of it is graded (Lane 140, C04): no figure, the week and
 * when it grades, "Week 7 not graded yet", "Grades once every game's stats are in, usually Wed Oct 28." The day is the
 * run's own for a set week (its last kickoff and the grading pass's wait), and absent for a week not
 * set yet, which says only the game it waits on. Null once a week is graded. */
export function weeklyPending(
	record: RunRecord,
	next: NextGrade | null
): { title: string; when: string } | null {
	if (next === null || record.weeks.some((week) => week.status === 'graded')) return null;
	const week = record.weeks.find((candidate) => candidate.week === next.week);
	const day = week?.gradesFrom === undefined ? null : weekdayLabel(week.gradesFrom);
	const game = next.lastKickoff === null ? null : weekdayWord(next.lastKickoff);
	return { title: RECORDS_WORDS.pending(next.week), when: RECORDS_WORDS.pendingWhen(day, game) };
}

/** The orders the weekly record draws, ours first (C15): ESPN's columns from its first week, empty
 * until a week is graded; the published projection's once a graded week carries it. */
export function weeklySources(record: RunRecord): readonly RecordSource[] {
	return ['ours', 'espn', ...(publishedDrawn(record) ? (['published'] as const) : [])];
}

/** The first week of the weekly record not graded yet, the one its bug names. */
export function nextToGrade(record: RunRecord): number | null {
	return record.weeks.find((week) => week.status !== 'graded')?.week ?? null;
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

/** The words the record's sentences are built from: the page's (RECORDS_WORDS), or a table of the
 * same keys. */
export type RecordsWords = {
	readonly [K in keyof typeof RECORDS_WORDS]: (typeof RECORDS_WORDS)[K] extends string
		? string
		: (typeof RECORDS_WORDS)[K];
};

/** The weeks before the weekly record, as one line that says the set rule once (C14): "Weeks 1 to
 * 6" and "Our rest-of-season order is graded week by week from week 7. Each week's order is set
 * before its first kickoff and graded as set, never as refreshed after. Before that ...". Null when
 * the record starts at week 1. */
export function beforeLine(
	fromWeek: number,
	words: RecordsWords = RECORDS_WORDS
): { lead: string; text: string } | null {
	if (fromWeek <= 1) return null;
	return { lead: words.beforeLead(fromWeek), text: words.before(fromWeek) };
}

/** The weeks before the weekly record as a phone draws them (Lane 209, Lane 208's F8): a chip a week,
 * "Wk 1" to "Wk 6", never the set rule's paragraph in a narrow cell. Empty when the record starts at
 * week 1. */
export function beforeChips(fromWeek: number): string[] {
	return Array.from({ length: Math.max(0, fromWeek - 1) }, (_, i) =>
		RECORDS_WORDS.beforeChip(i + 1)
	);
}

/** A sentence drawn at both widths, and one a desk alone draws: a phone holds eight lines of basis,
 * the figures' own sentences (Lane 131). */
const both = (text: string): BasisPart => ({ text, phone: true });
const deskOnly = (text: string): BasisPart => ({ text, phone: false });

/** The weekly record's basis (Lanes 131, 138, 140). Both widths say what each figure is: order
 * matched, places off, starters right in the lineup it counts, and, opened from a league, what the
 * league row's figures are. A desk also says what ESPN's projection is (its columns are drawn from the
 * first week, C15) with the season-long rule (C16) in the same sentence (Lane 163, D07), and when the
 * published projection's
 * column starts once drawn. The rest are said elsewhere, so the desk holds five lines (Lane 138): how
 * the rankings are set (the line before the weeks), what the league's lineup leaves uncounted (its
 * starters sentence names the lineup it counts), and the published projection's start before it is
 * drawn (the section's head names it). */
export function weeklyBasis(record: RunRecord, league: LeagueBasis | null): BasisPart[] {
	return [
		...saidOnly([
			record.scale,
			RECORD_WORDS.placesOff,
			league?.starters ?? record.startersBasis,
			league?.benchmark ? RECORDS_WORDS.leagueRow : null
		]).map(both),
		...saidOnly([
			RECORDS_WORDS.espnBasis,
			publishedDrawn(record) ? publishedWords(record) : null
		]).map(deskOnly)
	];
}

/** "Week 7", "Weeks 8 to 18". */
function spanLead(weeks: readonly RecordWeek[]): string {
	const first = weeks.at(0)?.week ?? 0;
	const last = weeks.at(-1)?.week ?? first;
	return first === last ? `Week ${String(first)}` : `Weeks ${String(first)} to ${String(last)}`;
}

/** A set week's row (C14): its own set time, then whether it is played, waiting or graded: "set Tue
 * Oct 20, 5:00 am Central, not played yet", "set ..., graded Wed Oct 28". */
function setWeekText(
	week: RecordWeek,
	unplayed: readonly number[],
	underway: readonly number[]
): string {
	if (week.frozenAt === null)
		throw new Error(`Week ${String(week.week)} is ${week.status} with no date.`);
	// The record's one clock, the one the run's other stamps are said on (C14).
	const set = RECORDS_WORDS.setAt(dayTimeStamp(week.frozenAt, BUILD_ZONE));
	const then =
		week.status === 'graded' && week.gradedAt !== null
			? RECORDS_WORDS.gradedOn(weekdayLabel(week.gradedAt))
			: unplayed.includes(week.week)
				? RECORDS_WORDS.notPlayed
				: underway.includes(week.week)
					? RECORDS_WORDS.underway
					: week.gradesFrom === undefined
						? RECORDS_WORDS.gradesLater
						: RECORDS_WORDS.gradesOn(weekdayLabel(week.gradesFrom));
	return `${set}, ${then}`;
}

/** The weekly record's week lines (fix round 1, M4): each set week with its own set time (C14), the
 * missed weeks as the record says them; of the weeks to come, the next to set on its own line with its kickoff day ("Week 7", "set before
 * kickoff Thu Oct 22") and the rest once ("Weeks 8 to 18", "set each week before kickoff"), so no line
 * reads as many weeks set on one day. */
export function weeklyLines(
	weeks: readonly RecordWeek[],
	unplayed: readonly number[],
	underway: readonly number[] = []
): WeekLine[] {
	const coming = weeks.filter((week) => week.status === 'upcoming');
	const lines = weekLines(
		weeks.filter((week) => week.status !== 'upcoming'),
		unplayed,
		underway
	).map((line) =>
		line.week === null ? line : { ...line, text: setWeekText(line.week, unplayed, underway) }
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

/** The sentence the run wrote under a week's row, drawn on a graded week only (Lane 148): a note
 * sent on a week not yet graded says nothing beside a comparison the page does not draw. */
export function weekNote(week: RecordWeek | null): string | undefined {
	return week?.status === 'graded' ? week.espnNote : undefined;
}

/** A set week's order on the weekly record: "Our rest-of-season order, set Oct 22". */
export function weeklyOrderWords(
	week: RecordWeek,
	words: RecordsWords = RECORDS_WORDS
): string | null {
	return week.frozenAt === null || week.order === null
		? null
		: words.weeklyOrder(dayLabel(week.frozenAt));
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
 * say how All combines the positions and what top named counts. Order matched and places off are
 * said once on the page, in the weekly record's basis above it (Lane 163, D07): the draft sentence
 * names the finish they are measured against, the season's points so far. */
export function draftBasis(draft: DraftRecord): BasisPart[] {
	return [
		...[
			RECORDS_WORDS.draftSet(weekdayLabel(draft.setAt), draft.throughWeek),
			RECORDS_WORDS.draftLeftOut
		].map(deskOnly),
		...saidOnly([RECORDS_WORDS.draftPositions, draft.namedBasis]).map(both)
	];
}

/** The draft record's figures for ours and ADP, each pair at one size with its leader (C05). */
export type DraftPairs = Readonly<Record<(typeof DRAFT_FIGURES)[number], FigurePair>>;

export function draftPairs(line: DraftLine): DraftPairs {
	const pair = (figure: RecordFigure): FigurePair =>
		figurePair(line.ours, line.adp, figure, RECORD_BOX.adp);
	return { agreement: pair('agreement'), placesOff: pair('placesOff'), starters: pair('starters') };
}

/** What each draft tile's figure is, under its head (C17): places off is better lower, and top named
 * counts the season's top players at each position graded ("of the top 12 QB, 24 RB, 36 WR, 12 TE");
 * null where a tile needs no key. */
export function draftKeys(
	draft: DraftRecord
): Readonly<Record<(typeof DRAFT_FIGURES)[number], string | null>> {
	const tops = draft.lines
		.filter((line) => line.position !== 'All' && line.ours.startersOf > 0)
		.map((line) => `${String(line.ours.startersOf)} ${line.position}`);
	return {
		agreement: null,
		placesOff: RECORDS_WORDS.lowerBetter,
		starters: tops.length === 0 ? null : RECORDS_WORDS.namedKey(tops.join(', '))
	};
}

/** A pair on the front card, its figure's head over the first yardstick's pair and none over the
 * next (Lane 142). */
export interface FrontPair extends FigurePair {
	label: string | null;
}

/** The front door's record card (ruling 4): the weekly record once a yardstick of it is graded, the
 * draft record until then, named either way. Each draws ours and its yardsticks as pairs at one
 * size (C05): ADP on the draft record; on the weekly one each yardstick graded, ESPN and the week's
 * published projection, the leader named per pair (Lane 142, ruling 2). */
export interface FrontRecord {
	name: string;
	/** Ours beside the yardstick, at one size, each naming its leader (C05, fix round 1 MEDIUM-2). */
	pairs: readonly FrontPair[];
	caption: string;
	/** The order matched scale, said under the figure (M4). */
	scale: string;
	second: string | null;
	note: string | null;
}

/** The weekly record's yardsticks, each with the line's ours it is compared with: on the season to
 * date, ours pooled again over the weeks that graded it (review 66j N1); on a week's line, ours. */
const OURS_ON = { espn: 'oursOnEspn', published: 'oursOnPublished' } as const;
type Yardstick = keyof typeof OURS_ON;
const isYardstick = (source: RecordSource): source is Yardstick => source in OURS_ON;

/** Ours beside each yardstick the weekly record draws, for one figure, each at one size with its
 * leader (Lane 140 fix round 1, HIGH-1: the C05 rule on the weekly record). */
export function weeklyPairs(
	line: RecordLine | undefined,
	figure: RecordFigure,
	sources: readonly RecordSource[]
): FigurePair[] {
	return sources.filter(isYardstick).map((source) => {
		const ours = line?.[OURS_ON[source]] ?? line?.ours ?? null;
		return figurePair(ours, line?.[source] ?? null, figure, RECORD_BOX[source]);
	});
}

/** Whether ours is drawn accented in a weekly cell: only where it leads every yardstick graded there;
 * with none graded there is nothing to lead. */
export function oursLeadsAll(pairs: readonly FigurePair[]): boolean {
	const graded = pairs.filter((pair) => pair.leader !== null);
	return graded.length > 0 && graded.every((pair) => pair.leader === 'ours');
}

function weeklyFront(weekly: RunRecord): FrontRecord | null {
	const graded = weekly.weeks.filter((week) => week.status === 'graded');
	const all = weekly.toDate.find((line) => line.position === 'All');
	if (graded.length === 0 || all === undefined || all.ours.agreement === null) return null;
	const first = graded[0]?.week ?? 0;
	const last = graded.at(-1)?.week ?? first;
	const span =
		first === last ? `week ${String(first)}` : `weeks ${String(first)} to ${String(last)}`;
	// The card's yardsticks: each the weekly record grades, ours at its size beside each with the
	// leader (Lane 142, ruling 2). With none graded yet the draft card says what it will compare against.
	const yardsticks = (['espn', 'published'] as const).filter((source) => all[source] !== null);
	if (yardsticks.length === 0) return null;
	const pair = (figure: RecordFigure, label: string): FrontPair[] =>
		weeklyPairs(all, figure, yardsticks).map((found, i) => ({
			...found,
			label: i === 0 ? label : null
		}));
	return {
		name: RECORDS_WORDS.weekly,
		pairs: [
			...pair('agreement', capitalized(weekly.statistic.agreement)),
			...(all.ours.startersOf === 0 ? [] : pair('starters', capitalized(weekly.statistic.starters)))
		],
		scale: weekly.scale,
		caption: RECORDS_WORDS.frontWeekly(span, plural(all.ours.graded, 'player')),
		second: null,
		note: null
	};
}

function draftFront(
	draft: DraftRecord,
	weekly: RunRecord | null,
	fromWeek: number | null,
	/** The run's name for order matched, its head on the card. */
	agreement: string
): FrontRecord | null {
	const all = draft.lines.find((line) => line.position === 'All');
	if (all === undefined || all.ours.agreement === null || draft.throughWeek === null) return null;
	const pairs = draftPairs(all);
	const heads = { agreement: capitalized(agreement), starters: RECORDS_WORDS.named };
	return {
		name: RECORDS_WORDS.draft,
		pairs: [
			{ ...pairs.agreement, label: heads.agreement },
			...(all.ours.startersOf === 0 ? [] : [{ ...pairs.starters, label: heads.starters }])
		],
		scale: RECORDS_WORDS.draftScale,
		caption: RECORDS_WORDS.frontDraft(draft.throughWeek, plural(all.ours.graded, 'player')),
		second: null,
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
		: draftFront(run.draft, weekly, run.weekly?.fromWeek ?? null, run.statistic.agreement);
}
