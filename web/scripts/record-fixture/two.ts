// THE TWO RECORDS' SHOTS RUN (Lane 114). The live record (record-live.json, the nightly's record from
// the dev store on Monday night of week 6) with the two records the nightly now writes beside it:
// - draft: draft-live.json, the draft record as research/nightly/reads/draft_record.py reads the dev
//   store at that instant (real figures, season points through week 5);
// - weekly: from week 7, as weekly_record.py writes it. `upcoming` is the state at the run (week 7 not
//   set yet, its kickoff Thu Oct 22). `graded` is a STAND-IN for the page after week 7 grades: week 7's
//   lines and players are week 2's from the live record with ADP's figures relabelled as ESPN's and ADP
//   removed, so the weekly table, its ESPN column, the league recount and the front card can be shot
//   before any week of weekly rankings exists. Its figures are not a grade of anything.
import { readFile } from 'node:fs/promises';
import type { RecordLine, RecordWeek, RunRecord } from '../../src/lib/run/schema.ts';

export type TwoMode = 'upcoming' | 'graded';

const FROM_WEEK = 7;
const SET_AT = '2026-10-22T18:00:00.000Z';
const GRADED_AT = '2026-10-28T22:00:00.000Z';

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

function gradedStandIn(source: RecordWeek): RecordWeek {
	return {
		...source,
		week: FROM_WEEK,
		frozenAt: SET_AT,
		gradedAt: GRADED_AT,
		order: 'rest_of_season',
		orderAsOf: '2026-10-22T09:00:00.000Z',
		lines: source.lines.map(asEspn),
		players: source.players?.map((p) => ({ ...p, espn: p.adp, adp: null, published: null }))
	};
}

/** The record with its two records, in the nightly's shape. */
export async function withTwoRecords(record: RunRecord, mode: TwoMode): Promise<unknown> {
	const draft = await json(new URL('draft-live.json', import.meta.url));
	const later = record.weeks.filter((week) => week.week > FROM_WEEK);
	const seven = record.weeks.find((week) => week.week === FROM_WEEK);
	const two = record.weeks.find((week) => week.week === 2);
	if (seven === undefined || two === undefined)
		throw new Error('the live record lacks week 2 or week 7');
	const first = mode === 'graded' ? gradedStandIn(two) : seven;
	const toDate = mode === 'graded' ? first.lines : [];
	return {
		...record,
		draft,
		weekly: {
			fromWeek: FROM_WEEK,
			statistic: record.statistic,
			scale: record.scale,
			startersBasis: mode === 'graded' ? record.startersBasis : null,
			method:
				mode === 'graded'
					? "From week 7 we set our weekly rankings before each week's first kickoff and graded them on the week's points, beside ESPN's projection on the same players."
					: "From week 7 we set our weekly rankings before each week's first kickoff and graded them on the week's points.",
			honest: null,
			weeks: [first, ...later],
			toDate
		}
	};
}
