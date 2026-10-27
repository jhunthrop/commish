/** Our record's parity (Lane 194): what the web's record page prints at 390
 * (routes/(run)/record/+page.svelte over WeeklySection.svelte and DraftSection.svelte, the page's
 * loader server/pages/record.ts with week-state.ts) for a run's record at a clock, by the run's
 * schedule, signed out, as JSON the apps' ports are held to: the page's lead; the weekly record's (or
 * the run's own record's) head and what it grades, its bug (the tiles with their pairs and leaders, the
 * pending week and when it grades, or the headline's one figure and its sentence), the gaps and the
 * honest sentence, the chips, the line before the weeks, every week line with its status words, its
 * order and, graded, its cells for every position, the week's ESPN sentence, the season to date, and
 * the phone's basis; the draft record's bug, rows and basis, or the line saying the next run writes it.
 * Written by export-parity.ts beside the others. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { weekdayLabel } from '../../web/src/lib/format/date.ts';
import { drawnText } from '../../web/src/lib/league/box/basis.ts';
import {
	RECORD_BOX,
	RECORD_FIGURES,
	allLine,
	besideOf,
	capitalized,
	figureWords,
	gapWords,
	gradedOrders,
	recordBasis,
	recordHeadline,
	recordLead,
	recordSources,
	scoreOf,
	standingWords,
	weekLines,
	weekOrderWords,
	type RecordFigure,
	type RecordSource
} from '../../web/src/lib/run/record.ts';
import { oursAccented, type FigurePair } from '../../web/src/lib/run/record-pair.ts';
import {
	DRAFT_FIGURES,
	DRAFT_SOURCES,
	RECORDS_WORDS,
	beforeLine,
	draftBasis,
	draftCell,
	draftHeads,
	draftKeys,
	draftPairs,
	draftRows,
	nextToGrade,
	oursLeadsAll,
	weekNote,
	weeklyAsRecord,
	weeklyBasis,
	weeklyLines,
	weeklyOrderWords,
	weeklyPairs,
	weeklyPending,
	weeklySources,
	weeklySpan,
	type NextGrade
} from '../../web/src/lib/run/records.ts';
import {
	manifestSchema,
	recordSchema,
	scheduleSchema,
	type RecordLine,
	type RunRecord,
	type Schedule
} from '../../web/src/lib/run/schema.ts';
import { weekStates } from '../../web/src/lib/server/pages/week-state.ts';
import { REPOSITORY } from './generated.ts';

export const RECORD_OUTPUT = 'shared/fixtures/parity/record.json';

const RUN = 'shared/fixtures/run/runs/2026-10-21T12-ros';

/** Each record the parity holds and the clocks its page is read at: the contract run's own record
 * (before Lane 114) on Sunday with week 6 under way and on the Thursday before week 7; the two records
 * before week 7 is set, and the STAND-IN week 7 graded, against ESPN alone and with the published
 * projection beside it, the Thursday after. */
export const RECORD_CASES: readonly {
	name: string;
	file: string;
	now: string;
}[] = [
	{
		name: 'own-sunday',
		file: `${RUN}/record.json`,
		now: '2026-10-18T18:56:00.000Z'
	},
	{ name: 'own', file: `${RUN}/record.json`, now: '2026-10-22T17:00:00.000Z' },
	// Week 6 played and waiting on its stats, with the day it usually grades (Lane 250, B254).
	{
		name: 'waiting',
		file: 'shared/fixtures/record/waiting.json',
		now: '2026-10-20T17:00:00.000Z'
	},
	{
		name: 'upcoming',
		file: 'shared/fixtures/record/upcoming.json',
		now: '2026-10-22T17:00:00.000Z'
	},
	{
		name: 'graded',
		file: 'shared/fixtures/record/graded.json',
		now: '2026-10-29T17:00:00.000Z'
	},
	{
		name: 'published',
		file: 'shared/fixtures/record/published.json',
		now: '2026-10-29T17:00:00.000Z'
	}
];

async function json(path: string): Promise<unknown> {
	return JSON.parse(await readFile(join(REPOSITORY, path), 'utf8')) as unknown;
}

/** The weekly record's next week to grade with its last kickoff (server/pages/record.ts nextGrade). */
function nextGrade(weekly: RunRecord, schedule: Schedule): NextGrade | null {
	const week = nextToGrade(weekly);
	if (week === null) return null;
	const kickoffs = schedule.slates
		.flatMap((slate) => slate.games)
		.filter((game) => game.week === week)
		.map((game) => Date.parse(game.kickoff));
	return {
		week,
		lastKickoff: kickoffs.length === 0 ? null : new Date(Math.max(...kickoffs)).toISOString()
	};
}

const pairOf = (pair: FigurePair): unknown => ({
	ours: pair.ours,
	theirs: pair.theirs,
	name: pair.name,
	leader: pair.leader,
	lead: pair.lead,
	accented: oursAccented(pair)
});

const SOURCE_HEADS: Readonly<Record<RecordSource, string>> = {
	ours: RECORD_BOX.ours,
	adp: RECORD_BOX.adp,
	espn: RECORD_BOX.espn,
	published: RECORD_BOX.published
};

/** A line's cells for every figure and order drawn, as the week table prints them, and whether ours
 * is drawn trailing (the weekly record accents ours only where it leads every yardstick). */
function cellsOf(
	line: RecordLine | undefined,
	sources: readonly RecordSource[],
	weekly: boolean
): unknown {
	return Object.fromEntries(
		RECORD_FIGURES.map((figure) => [
			figure,
			{
				trails: weekly && !oursLeadsAll(weeklyPairs(line, figure, sources)),
				cells: sources.map((source) =>
					source === 'ours'
						? {
								source,
								value: figureWords(scoreOf(line, source), figure),
								same: null
							}
						: {
								source,
								value: besideOf(line, source, figure).value,
								same: besideOf(line, source, figure).ours
							}
				)
			}
		])
	);
}

/** A graded week's caption: the order with when it was graded on the weekly record, whose order
 * words carry the set date; the order with the run's own words on the record before Lane 114. */
function captionOf(
	week: RunRecord['weeks'][number] | null,
	order: string | null,
	text: string,
	weekly: boolean
): string {
	if (order === null) return capitalized(text);
	if (!weekly || week === null || week.gradedAt === null) return `${order}, ${text}`;
	return `${order}, ${RECORDS_WORDS.gradedOn(weekdayLabel(week.gradedAt))}`;
}

/** The weekly record's section (or the run's own before Lane 114) as WeeklySection draws it. */
function weeklySection(
	record: RunRecord,
	fromWeek: number | null,
	unplayed: readonly number[],
	underway: readonly number[],
	next: NextGrade | null
): unknown {
	const weekly = fromWeek !== null;
	const figureHeads: Record<RecordFigure, string> = {
		agreement: record.statistic.agreement,
		placesOff: record.statistic.placesOff,
		starters: record.statistic.starters
	};
	const sources = weekly ? weeklySources(record) : recordSources(record);
	const toDateAll = allLine(record.toDate);
	const pending = weekly ? weeklyPending(record, next) : null;
	const headline = recordHeadline(record, unplayed);
	const gaps = gapWords(record, unplayed);
	const before = fromWeek === null ? null : beforeLine(fromWeek);
	const rows = weekly
		? weeklyLines(record.weeks, unplayed, underway)
		: weekLines(record.weeks, unplayed, underway);
	const positions = record.toDate.map((line) => line.position);
	const bug =
		toDateAll === undefined
			? pending === null
				? {
						kind: 'headline',
						value: headline.value,
						caption: headline.caption,
						gaps
					}
				: { kind: 'pending', title: pending.title, when: pending.when, gaps }
			: {
					kind: 'tiles',
					standing: standingWords(record),
					head: weekly ? weeklySpan(record) : gradedOrders(record),
					tiles: RECORD_FIGURES.map((figure) =>
						weekly
							? {
									label: figureHeads[figure],
									pairs: weeklyPairs(toDateAll, figure, sources).map(pairOf),
									values: null
								}
							: {
									label: figureHeads[figure],
									pairs: null,
									values: {
										ours: figureWords(scoreOf(toDateAll, 'ours'), figure),
										beside: sources
											.filter((source) => source !== 'ours')
											.map((source) => {
												const shown = besideOf(toDateAll, source, figure);
												return {
													head: SOURCE_HEADS[source],
													value: shown.value,
													ours: shown.ours === null ? null : shown.ours.toLowerCase()
												};
											})
									}
								}
					),
					gaps,
					honest: record.honest
				};
	return {
		head: weekly ? { title: RECORDS_WORDS.weekly, what: RECORDS_WORDS.weeklyWhat } : null,
		bug,
		positions: positions.length > 1 ? positions : [],
		figures: RECORD_FIGURES.map((figure) => capitalized(figureHeads[figure])),
		sourceHeads: sources.map((source) => SOURCE_HEADS[source]),
		before,
		rows: rows.map((row) => {
			const graded = row.week !== null && row.week.status === 'graded';
			const order =
				row.week?.order === null || row.week === null
					? null
					: weekly
						? weeklyOrderWords(row.week)
						: weekOrderWords(row.week);
			return {
				lead: row.lead,
				text: capitalized(row.text),
				order,
				// The app's line under a graded week on a phone, the set date said once (the web's Status
				// column, hidden below 1180 px).
				caption: graded ? captionOf(row.week, order, row.text, weekly) : null,
				graded,
				players: graded
					? String(allLine(row.week?.lines ?? [])?.ours.graded ?? RECORD_BOX.none)
					: null,
				cells: graded
					? Object.fromEntries(
							positions.map((position) => [
								position,
								cellsOf(
									row.week?.lines.find((line) => line.position === position),
									sources,
									weekly
								)
							])
						)
					: null,
				note: weekly ? (weekNote(row.week) ?? null) : null
			};
		}),
		toDate:
			toDateAll === undefined
				? null
				: {
						lead: RECORD_BOX.toDate,
						players: RECORD_BOX.distinct(toDateAll.ours.graded),
						cells: Object.fromEntries(
							positions.map((position) => [
								position,
								cellsOf(
									record.toDate.find((line) => line.position === position),
									sources,
									weekly
								)
							])
						)
					},
		basis: weekly ? drawnText(weeklyBasis(record, null), 'phone') : recordBasis(record).join(' ')
	};
}

/** The draft record's section as DraftSection draws it, or its line before a run writes it. */
function draftSection(run: RunRecord): unknown {
	const draft = run.draft;
	const head = { title: RECORDS_WORDS.draft, what: RECORDS_WORDS.draftWhat };
	if (draft === undefined) return { head, waiting: RECORDS_WORDS.waiting };
	const heads = draftHeads(run);
	const rows = draftRows(draft);
	const keys = draftKeys(draft);
	const line = (drafted: (typeof draft.lines)[number]): unknown => {
		const pairs = draftPairs(drafted);
		return {
			position: drafted.position,
			players: drafted.ours.graded,
			cells: Object.fromEntries(
				DRAFT_FIGURES.map((figure) => [
					figure,
					{
						accented: oursAccented(pairs[figure]),
						cells: DRAFT_SOURCES.map((source) => draftCell(drafted, source, figure))
					}
				])
			)
		};
	};
	const all = rows.all;
	return {
		head,
		waiting: null,
		bug:
			all === null
				? null
				: {
						span: RECORDS_WORDS.draftSpan(draft.throughWeek),
						players: RECORDS_WORDS.draftPlayers(all.ours.graded),
						tiles: DRAFT_FIGURES.map((figure) => ({
							label: heads[figure],
							key: keys[figure],
							pair: pairOf(draftPairs(all)[figure])
						})),
						honest: draft.honest
					},
		figures: DRAFT_FIGURES.map((figure) => capitalized(heads[figure])),
		sourceHeads: DRAFT_SOURCES.map((source) => SOURCE_HEADS[source]),
		heads: {
			position: RECORDS_WORDS.position,
			players: RECORDS_WORDS.players,
			all: RECORDS_WORDS.all
		},
		rows: rows.positions.map(line),
		all: all === null ? null : line(all),
		basis: drawnText(draftBasis(draft), 'phone')
	};
}

async function recordCase(file: string, now: string): Promise<unknown> {
	const run = recordSchema.parse(await json(file));
	const schedule = scheduleSchema.parse(await json(`${RUN}/schedule.json`));
	const manifest = manifestSchema.parse(await json(`${RUN}/manifest.json`));
	const scoring = manifest.formats.find((format) => format.id === run.format)?.label ?? run.format;
	const at = Date.parse(now);
	const weekly = weeklyAsRecord(run);
	// The run's own record travels without its weekly one (server/pages/record.ts).
	const own = { ...run, weekly: undefined };
	const states = weekStates(own, schedule, at);
	const weeklyStates = weekly === null ? null : weekStates(weekly, schedule, at);
	return {
		now,
		file,
		scoring,
		states,
		lead: weekly === null ? recordLead(own, scoring) : RECORDS_WORDS.lead,
		weekly:
			weekly === null || run.weekly === undefined || weeklyStates === null
				? weeklySection(own, null, states.unplayed, states.underway, null)
				: weeklySection(
						weekly,
						run.weekly.fromWeek,
						weeklyStates.unplayed,
						weeklyStates.underway,
						nextGrade(weekly, schedule)
					),
		draft: draftSection(run)
	};
}

export async function renderRecord(about: string): Promise<string> {
	const cases: Record<string, unknown> = {};
	for (const c of RECORD_CASES) cases[c.name] = await recordCase(c.file, c.now);
	return `${JSON.stringify({ about, schedule: `${RUN}/schedule.json`, cases }, null, '\t')}\n`;
}
