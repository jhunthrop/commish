// THE TWO RECORDS' SHOTS RUN (Lane 114). The live record (record-live.json, the nightly's record from
// the dev store on Monday night of week 6) with the two records the nightly now writes beside it:
// - draft: draft-live.json, the draft record as research/nightly/reads/draft_record.py reads the dev
//   store at that instant (real figures, season points through week 5);
// - weekly: from week 7, as weekly_record.py writes it. `upcoming` is the state at the run (week 7 not
//   set yet, its kickoff Thu Oct 22). `graded` is a STAND-IN for the page after week 7 grades: week 7's
//   lines and players are week 2's from the live record with ADP's figures relabelled as ESPN's and ADP
//   removed, so the weekly table, its ESPN column, the league recount and the front card can be shot
//   before any week of weekly rankings exists. Its figures are not a grade of anything.
//   `published` is the same STAND-IN with the week's published projection graded beside ESPN (Lane
//   142): its figures are week 1's ADP lines relabelled, so the front card's two yardsticks can be
//   shot. They are not a grade of anything either. The graded week 7 carries the run's ESPN sentence
//   (Lane 147), its yardstick read after the set as the week's real one was.
//   `set-missed` is `set` with week 6 before it, its first kickoff passed with no order set (Lane 273).
//   `set` is week 7 set and played, waiting on its stats (Lane 250): its grading day is what
//   research's `week_complete.grades_from` writes for its last kickoff (Mon Oct 26 night), Tuesday
//   20:30 Eastern, held to that by research/tests/test_lane250_record_fixtures.py.
import { readFile } from 'node:fs/promises';
import { RECORDS_WORDS } from '../../src/lib/run/records.ts';
import type { RecordLine, RecordWeek, RunRecord } from '../../src/lib/run/schema.ts';

export type TwoMode = 'upcoming' | 'set' | 'set-missed' | 'graded' | 'published';

const FROM_WEEK = 7;
const SET_AT = '2026-10-22T18:00:00.000Z';
const GRADED_AT = '2026-10-28T22:00:00.000Z';
/** Week 7's first grading pass, `grades_from` of its last kickoff (2026-10-27T00:15Z). */
const SEVEN_GRADES_FROM = '2026-10-28T00:30:00.000Z';
/** The run's weekly record writer, whose word table holds the method sentence (Lane 235, B222). */
const WRITER = new URL('../../../research/nightly/reads/weekly_record.py', import.meta.url);

/** A string constant of the writer's word table as written: one literal, or a parenthesised run of
 * adjacent literals, joined. */
function pythonConstant(source: string, name: string): string {
	const found = new RegExp(
		`^${name}: Final = (?:\\(\\n([\\s\\S]*?)\\n\\)|("[^"\\n]*")$)`,
		'mu'
	).exec(source);
	const literals = found?.[1] ?? found?.[2];
	if (literals === undefined) throw new Error(`${name} is not in the run's word table`);
	return [...literals.matchAll(/"([^"]*)"/gu)].map((match) => match[1]).join('');
}

/** The weekly record's method as the run writes it (weekly_record.py `method`), built from the
 * writer's own word table so the fixtures never carry a sentence the run no longer writes. */
async function runMethod(beside: readonly string[]): Promise<string> {
	const source = await readFile(WRITER, 'utf8');
	const clause =
		beside.length === 0
			? ''
			: pythonConstant(source, '_BESIDE').replace('{names}', beside.join(' and '));
	return pythonConstant(source, '_METHOD')
		.replace('{week}', String(FROM_WEEK))
		.replace('{beside}', clause);
}

async function json(url: URL): Promise<unknown> {
	return JSON.parse(await readFile(url, 'utf8')) as unknown;
}

function asEspn(line: RecordLine): RecordLine {
	return {
		...line,
		adp: null,
		espn: line.adp,
		oursOnEspn: null,
		published: null,
		oursOnPublished: null
	};
}

/** A line with the published projection's figures from another week's ADP at its position. */
function withPublished(line: RecordLine, from: readonly RecordLine[]): RecordLine {
	return { ...line, published: from.find((f) => f.position === line.position)?.adp ?? null };
}

function gradedStandIn(source: RecordWeek, published: readonly RecordLine[] | null): RecordWeek {
	const lines = source.lines.map(asEspn);
	return {
		...source,
		week: FROM_WEEK,
		frozenAt: SET_AT,
		gradedAt: GRADED_AT,
		order: 'rest_of_season',
		orderAsOf: '2026-10-22T09:00:00.000Z',
		lines: published === null ? lines : lines.map((line) => withPublished(line, published)),
		players: source.players?.map((p) => ({ ...p, espn: p.adp, adp: null, published: null })),
		// Week 7's ESPN yardstick came from a read after the set (Lane 146's hand fill), so the run says
		// so under its row (Lane 147); week 8 to come says nothing.
		espnNote: RECORDS_WORDS.espnReadAfter
	};
}

/** Week 7 set before its first kickoff with the shipped order, played, its stats not in. */
function setWaiting(seven: RecordWeek): RecordWeek {
	return {
		...seven,
		status: 'frozen',
		frozenAt: SET_AT,
		frozenBy: '2026-10-22T18-live',
		order: 'rest_of_season',
		orderAsOf: '2026-10-22T09:00:00.000Z',
		gradedAt: null,
		population: 0,
		lines: [],
		gradesFrom: SEVEN_GRADES_FROM
	};
}

/** The week before the set one, its first kickoff passed with no order set, as weekly_record.py writes
 * a missed week (Lane 273): it never froze, so it carries no set time. */
function missedBefore(week: number): RecordWeek {
	return {
		week,
		status: 'missed',
		frozenAt: null,
		frozenBy: null,
		order: null,
		gradedAt: null,
		population: 0,
		lines: [],
		note: 'Our order was not set before kickoff that week.'
	};
}

/** The record with its two records, in the nightly's shape. */
export async function withTwoRecords(record: RunRecord, mode: TwoMode): Promise<unknown> {
	const draft = await json(new URL('draft-live.json', import.meta.url));
	const later = record.weeks.filter((week) => week.week > FROM_WEEK);
	const seven = record.weeks.find((week) => week.week === FROM_WEEK);
	const one = record.weeks.find((week) => week.week === 1);
	const two = record.weeks.find((week) => week.week === 2);
	if (seven === undefined || one === undefined || two === undefined)
		throw new Error('the live record lacks week 1, 2 or 7');
	const graded = mode === 'graded' || mode === 'published';
	const first = graded
		? gradedStandIn(two, mode === 'published' ? one.lines : null)
		: mode === 'set' || mode === 'set-missed'
			? setWaiting(seven)
			: seven;
	const toDate = graded ? first.lines : [];
	const missed = mode === 'set-missed' ? [missedBefore(FROM_WEEK - 1)] : [];
	return {
		...record,
		draft,
		weekly: {
			fromWeek: FROM_WEEK - missed.length,
			statistic: record.statistic,
			scale: record.scale,
			startersBasis: graded ? record.startersBasis : null,
			method: await runMethod(graded ? ["ESPN's projection"] : []),
			honest: null,
			weeks: [...missed, first, ...later],
			toDate
		}
	};
}
