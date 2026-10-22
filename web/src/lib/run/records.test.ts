// The two records (Lane 114): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { BasisPart } from './board-basis.ts';
import {
	HELD_OUT_METHOD,
	RECORD_WORDS,
	publishedWords,
	recordSources,
	weekLines
} from './record.ts';
import {
	RECORDS_WORDS,
	beforeLine,
	draftBasis,
	draftRows,
	draftSeries,
	frontRecord,
	weeklyAsRecord,
	weeklyBasis,
	weeklyLines,
	weeklyOpening,
	weeklyOrderWords,
	weeklySpan
} from './records.ts';
import {
	leagueRankingRows,
	leagueSentenceWeeks,
	leagueToDate,
	weekSentence
} from './record-league.ts';
import type { LeagueRecord } from './record-league.ts';
import {
	recordSchema,
	type DraftRecord,
	type RecordWeek,
	type RunRecord,
	type Score
} from './schema.ts';

const score = (agreement: number, starters = 61): Score => ({
	graded: 214,
	agreement,
	placesOff: 19.4,
	starters,
	startersOf: 84
});

const upcoming = (week: number, at: string): RecordWeek => ({
	week,
	status: 'upcoming',
	frozenAt: at,
	frozenBy: null,
	order: null,
	gradedAt: null,
	population: 0,
	lines: []
});

const gradedSeven: RecordWeek = {
	week: 7,
	status: 'graded',
	frozenAt: '2026-10-22T18:00:00.000Z',
	frozenBy: '2026-10-22T04',
	order: 'rest_of_season',
	gradedAt: '2026-10-28T22:00:00.000Z',
	population: 214,
	lines: [
		{
			position: 'All',
			ours: score(0.62),
			adp: null,
			espn: score(0.58, 58),
			oursOnEspn: null,
			published: null,
			oursOnPublished: null
		}
	]
};

const draft: DraftRecord = {
	setAt: '2026-09-08T12:00:16.244Z',
	boardAsOf: '2026-09-07T21:57:33.121Z',
	throughWeek: 5,
	namedBasis:
		"Top named counts the season's top 12 QBs so far, and how many of them the order also put in its top 12.",
	honest: null,
	lines: [
		{ position: 'All', ours: score(0.61, 56), adp: score(0.48, 60) },
		{ position: 'QB', ours: score(0.29, 6), adp: score(0.39, 8) }
	],
	progress: [
		{ week: 1, ours: 0.5, adp: 0.41 },
		{ week: 2, ours: null, adp: 0.44 }
	]
};

function run(over: Partial<RunRecord>): RunRecord {
	return recordSchema.parse({
		season: 2026,
		format: 'ppr-12',
		statistic: { agreement: 'order matched', placesOff: 'places off', starters: 'starters right' },
		scale: 'Order matched is how closely an order ranked the players.',
		startersBasis: null,
		method: 'Each week we set our order.',
		publishedFromWeek: null,
		honest: null,
		weeks: [],
		toDate: [],
		...over
	});
}

const weekly = (weeks: RecordWeek[], toDate = gradedSeven.lines) => ({
	fromWeek: 7,
	statistic: { agreement: 'order matched', placesOff: 'places off', starters: 'starters right' },
	scale: 'Order matched is how closely an order ranked the players.',
	startersBasis: null,
	method: 'From week 7 we set our weekly rankings.',
	honest: null,
	weeks,
	toDate
});

void test('a run before Lane 114 parses, with ESPN null on every line and no records', () => {
	const old = run({
		toDate: [
			{
				position: 'All',
				ours: score(0.48),
				adp: score(0.37),
				published: null,
				oursOnPublished: null
			} as unknown as RunRecord['toDate'][number]
		]
	});
	assert.equal(old.toDate[0]?.espn, null);
	assert.equal(old.weekly, undefined);
	assert.equal(weeklyAsRecord(old), null);
	assert.equal(frontRecord(old), null);
	assert.deepEqual(recordSources(old), ['ours', 'adp']);
});

void test('the weekly record reads as a record with ESPN beside ours and no ADP column', () => {
	const shown = weeklyAsRecord(run({ weekly: weekly([gradedSeven]) }));
	assert.ok(shown);
	assert.deepEqual(recordSources(shown), ['ours', 'espn']);
	assert.equal(shown.publishedFromWeek, null);
	assert.equal(weekLines(shown.weeks)[0]?.text, 'set Thu Oct 22, graded Wed Oct 28');
});

void test('weeks 1 to 6 are one line that names the first week of weekly rankings and its set day', () => {
	const ahead = upcoming(7, '2026-10-23T00:15:00.000Z');
	assert.deepEqual(beforeLine(7, ahead), {
		lead: 'Weeks 1 to 6',
		text: 'Weekly rankings start week 7 (set before kickoff Thu Oct 22). Before that the site shipped the draft board, graded under Draft record.'
	});
	assert.equal(beforeLine(7, gradedSeven)?.text.includes('(set Thu Oct 22)'), true);
	assert.equal(beforeLine(1, ahead), null);
	assert.equal(beforeLine(2, ahead)?.lead, 'Week 1');
});

/** A basis's words at a width: a phone draws its phone parts, a desk every part but a phone-only one. */
const drawnOn = (parts: readonly BasisPart[], width: 'phone' | 'desk'): string[] =>
	parts
		.filter((part) => (width === 'phone' ? part.phone : part.desk !== false))
		.map((part) => part.text);

void test("the weekly basis: a phone says the figures' sentences, a desk the qualifications too (Lane 131)", () => {
	const record = {
		...run({}),
		...weekly([gradedSeven]),
		startersBasis: 'Starters right counts a standard lineup.'
	};
	const phone = [record.scale, RECORD_WORDS.placesOff, 'Starters right counts a standard lineup.'];
	assert.deepEqual(drawnOn(weeklyBasis(record, null, true), 'phone'), phone);
	assert.deepEqual(drawnOn(weeklyBasis(record, null, true), 'desk'), [
		record.method,
		HELD_OUT_METHOD,
		...phone,
		publishedWords(record),
		RECORDS_WORDS.espnBasis,
		RECORDS_WORDS.yahooBasis
	]);
	assert.ok(!drawnOn(weeklyBasis(record, null, false), 'desk').includes(RECORDS_WORDS.espnBasis));
	const league = { starters: 'In your lineup.', aside: 'No kickers.', benchmark: 'ESPN too.' };
	const opened = weeklyBasis(record, league, true);
	assert.deepEqual(drawnOn(opened, 'phone'), [
		record.scale,
		RECORD_WORDS.placesOff,
		'In your lineup.'
	]);
	for (const qualification of ['No kickers.', 'ESPN too.'])
		assert.ok(drawnOn(opened, 'desk').includes(qualification), qualification);
});

void test('the front card shows the draft record until a weekly week is graded, then the weekly one', () => {
	const before = frontRecord(
		run({ draft, weekly: weekly([upcoming(7, '2026-10-23T00:15:00.000Z')], []) })
	);
	assert.deepEqual(before, {
		name: 'Draft record',
		value: '0.61',
		scale: RECORDS_WORDS.draftScale,
		caption: 'Order matched, our draft board through week 5, 214 players. ADP 0.48.',
		second: 'Top named 56 of 84, ADP 60.',
		note: 'Weekly rankings start week 7.'
	});
	const after = frontRecord(run({ draft, weekly: weekly([gradedSeven]) }));
	assert.deepEqual(after, {
		name: 'Weekly record',
		value: '0.62',
		scale: 'Order matched is how closely an order ranked the players.',
		caption: 'Order matched, our weekly rankings over week 7, 214 players. ESPN 0.58.',
		second: 'Starters right 61 of 84, ESPN 58 of 84.',
		note: null
	});
});

void test('the draft table lists each position, All as its totals, and its chart skips a missing point', () => {
	const rows = draftRows(draft);
	assert.deepEqual(
		rows.positions.map((line) => line.position),
		['QB']
	);
	assert.equal(rows.all?.position, 'All');
	assert.deepEqual(draftSeries(draft), {
		ours: [{ week: 1, value: 0.5 }],
		adp: [
			{ week: 1, value: 0.41 },
			{ week: 2, value: 0.44 }
		]
	});
});

void test("the draft basis: a phone says the figures' sentences, a desk when the board was set too (Lane 131)", () => {
	const basis = draftBasis(draft);
	assert.deepEqual(drawnOn(basis, 'phone'), [
		RECORDS_WORDS.draftPositions,
		RECORDS_WORDS.draftScale,
		RECORD_WORDS.placesOff,
		draft.namedBasis
	]);
	const desk = drawnOn(basis, 'desk');
	assert.match(desk[0] ?? '', /^Our draft board is the preseason order we set Tue Sep 8/u);
	assert.match(desk[1] ?? '', /through week 5 in PPR/u);
	assert.ok(desk.includes(RECORDS_WORDS.draftBye) && desk.includes(RECORDS_WORDS.draftKickers));
	assert.equal(desk.at(-1), draft.namedBasis);
});

const league: LeagueRecord = {
	host: 'espn',
	teams: 12,
	lineup: { qb: 1, rb: 2, wr: 2, te: 1, flex: 1, super_flex: 0, k: 1, def: 1, bench: 7 },
	weeks: [
		{
			week: 7,
			benchmark: 'espn',
			ours: 112.4,
			theirs: 104,
			margin: 8.4,
			ranking: {
				players: 168,
				ours: { agreement: 0.6, places_off: 14.2, starters: 71, starters_of: 108 },
				espn: { agreement: 0.57, places_off: 15, starters: 69, starters_of: 108 }
			}
		},
		{ week: 8, benchmark: 'published', ours: 90, theirs: 93.1, margin: -3.1 }
	]
};

void test("an ESPN league's weekly record is a row a week and one sentence to date, in the ruling's words", () => {
	const rows = leagueRankingRows(league);
	assert.equal(rows.length, 1);
	assert.deepEqual(rows[0]?.ours, {
		graded: 168,
		agreement: 0.6,
		placesOff: 14.2,
		starters: 71,
		startersOf: 108
	});
	assert.equal(
		leagueToDate(rows),
		'Following us instead of ESPN would have scored 8.4 more points over 1 week.'
	);
	assert.deepEqual(
		leagueSentenceWeeks(league).map((week) => weekSentence(week)),
		[
			"Week 8: following the week's published projection instead of us would have scored 3.1 more points, 93.1 to 90.0."
		]
	);
	assert.equal(leagueToDate([]), null);
});

void test('the records say no banned word and no em-dash', () => {
	const said: string[] = [
		...Object.values(RECORDS_WORDS).flatMap((value: unknown) =>
			typeof value === 'string' ? [value] : []
		),
		RECORDS_WORDS.before(7, 'set before kickoff Thu Oct 22'),
		RECORDS_WORDS.draftSet('Tue Sep 8'),
		RECORDS_WORDS.draftGraded(5),
		RECORDS_WORDS.draftGraded(null)
	];
	for (const words of said) {
		assert.doesNotMatch(words, bannedPattern(), words);
		assert.doesNotMatch(words, /\u2014/u, words);
	}
});

void test('before its first week is set the weekly record says that week and when it is set', () => {
	const ahead = weeklyAsRecord(
		run({ weekly: weekly([upcoming(7, '2026-10-23T00:15:00.000Z')], []) })
	);
	assert.ok(ahead);
	assert.deepEqual(weeklyOpening(ahead, 7), {
		value: 'Week 7',
		caption: 'Our first weekly rankings, set before kickoff Thu Oct 22.'
	});
	const graded = weeklyAsRecord(run({ weekly: weekly([gradedSeven]) }));
	assert.ok(graded);
	assert.equal(weeklyOpening(graded, 7), null);
});

void test('the weeks to come read one line per state: the next with its day, the rest once (M4)', () => {
	const weeks = [
		gradedSeven,
		upcoming(8, '2026-10-30T00:15:00.000Z'),
		upcoming(9, '2026-11-06T01:15:00.000Z'),
		upcoming(18, '2027-01-03T18:00:00.000Z')
	];
	assert.deepEqual(
		weeklyLines(weeks, []).map((line) => [line.lead, line.text]),
		[
			['Week 7', 'set Thu Oct 22, graded Wed Oct 28'],
			['Week 8', 'set before kickoff Thu Oct 29'],
			['Weeks 9 to 18', 'set each week before kickoff']
		]
	);
	assert.deepEqual(
		weeklyLines([upcoming(7, '2026-10-23T00:15:00.000Z')], []).map((line) => line.text),
		['set before kickoff Thu Oct 22']
	);
});

void test('the weekly record names its weeks and its order as weekly rankings, never rest of season (M2)', () => {
	const shown = weeklyAsRecord(run({ weekly: weekly([gradedSeven]) }));
	assert.ok(shown);
	assert.equal(weeklySpan(shown), 'Week 7');
	assert.equal(weeklyOrderWords(gradedSeven), 'Our weekly rankings, set Oct 22');
	assert.equal(weeklyOrderWords(upcoming(8, '2026-10-30T00:15:00.000Z')), null);
});
