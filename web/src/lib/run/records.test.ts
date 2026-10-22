// The two records (Lane 114): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { BasisPart } from './board-basis.ts';
import { RECORD_WORDS, publishedWords, recordSources, weekLines } from './record.ts';
import {
	RECORDS_WORDS,
	beforeLine,
	draftBasis,
	draftRows,
	draftSeries,
	frontRecord,
	weeklyAsRecord,
	weeklyBasis,
	draftKeys,
	draftPairs,
	weeklyLines,
	weeklyOrderWords,
	weeklyPending,
	weeklySources,
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
		"Top named counts how many of the season's top 12 QBs so far the order also ranked that high.",
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

void test('weeks 1 to 6 are one line that says the set rule once (C14)', () => {
	assert.deepEqual(beforeLine(7), {
		lead: 'Weeks 1 to 6',
		text: "Weekly rankings start week 7. Each week's are set before its first kickoff and graded as set, never as refreshed after. Before that the site shipped the draft board, graded under Draft record."
	});
	assert.equal(beforeLine(1), null);
	assert.equal(beforeLine(2)?.lead, 'Week 1');
});

void test("the weekly record draws ESPN's columns from its first week, the published projection's once graded (C15)", () => {
	const ahead = weeklyAsRecord(
		run({ weekly: weekly([upcoming(7, '2026-10-23T00:15:00.000Z')], []) })
	);
	assert.ok(ahead);
	assert.deepEqual(weeklySources(ahead), ['ours', 'espn']);
	const published = weeklyAsRecord(
		run({
			weekly: weekly(
				[gradedSeven],
				gradedSeven.lines.map((line) => ({ ...line, published: score(0.55) }))
			)
		})
	);
	assert.ok(published);
	assert.deepEqual(weeklySources(published), ['ours', 'espn', 'published']);
	assert.match(
		RECORDS_WORDS.lead,
		/our weekly rankings against ESPN and the week's published projection,/u
	);
	assert.equal(
		RECORDS_WORDS.weeklyWhat,
		"Our weekly rankings against ESPN and the week's published projection"
	);
});

/** A basis's words at a width: a phone draws its phone parts, a desk every part but a phone-only one. */
const drawnOn = (parts: readonly BasisPart[], width: 'phone' | 'desk'): string[] =>
	parts
		.filter((part) => (width === 'phone' ? part.phone : part.desk !== false))
		.map((part) => part.text);

void test("the weekly basis: both widths say the figures' sentences, a desk ESPN's and the season-long rule more (Lanes 131, 138, 140)", () => {
	const record = {
		...run({}),
		...weekly([gradedSeven]),
		startersBasis: 'Starters right counts a standard lineup.'
	};
	const phone = [record.scale, RECORD_WORDS.placesOff, 'Starters right counts a standard lineup.'];
	assert.deepEqual(drawnOn(weeklyBasis(record, null), 'phone'), phone);
	// The method and the published projection's promise are said elsewhere; Yahoo is not named (C27).
	assert.deepEqual(drawnOn(weeklyBasis(record, null), 'desk'), [
		...phone,
		RECORDS_WORDS.espnBasis,
		RECORDS_WORDS.seasonLong
	]);
	assert.ok(!drawnOn(weeklyBasis(record, null), 'desk').some((text) => text.includes('Yahoo')));
	const withPublished = {
		...record,
		publishedFromWeek: 7,
		toDate: record.toDate.map((line) => ({ ...line, published: score(0.55) }))
	};
	assert.ok(
		drawnOn(weeklyBasis(withPublished, null), 'desk').includes(publishedWords(withPublished)),
		"the published column's start, once drawn"
	);
	const league = { starters: 'In your lineup.', benchmark: 'ESPN too.' };
	const opened = weeklyBasis(record, league);
	const figures = [
		record.scale,
		RECORD_WORDS.placesOff,
		'In your lineup.',
		RECORDS_WORDS.leagueRow
	];
	assert.deepEqual(drawnOn(opened, 'phone'), figures);
	assert.deepEqual(drawnOn(opened, 'desk'), [
		...figures,
		RECORDS_WORDS.espnBasis,
		RECORDS_WORDS.seasonLong
	]);
	const noBenchmark = weeklyBasis(record, { ...league, benchmark: null });
	assert.ok(!drawnOn(noBenchmark, 'desk').includes(RECORDS_WORDS.leagueRow));
});

void test('the front card shows the draft record until a weekly week is graded, then the weekly one', () => {
	const before = frontRecord(
		run({ draft, weekly: weekly([upcoming(7, '2026-10-23T00:15:00.000Z')], []) })
	);
	// Ours and ADP at one size, each pair naming its leader (C05).
	assert.deepEqual(before, {
		name: 'Draft record',
		value: null,
		pairs: [
			{
				label: 'Order matched',
				ours: '0.61',
				theirs: '0.48',
				name: 'ADP',
				leader: 'ours',
				lead: 'ours by 0.13'
			},
			{
				label: 'Top named',
				ours: '56 of 84',
				theirs: '60 of 84',
				name: 'ADP',
				leader: 'theirs',
				lead: 'ADP by 4'
			}
		],
		scale: RECORDS_WORDS.draftScale,
		caption: 'Our draft board through week 5, 214 players.',
		second: null,
		note: 'Weekly rankings start week 7.'
	});
	assert.match(RECORDS_WORDS.draftScale, /below 0\.00 the order runs backwards\.$/u);
	const after = frontRecord(run({ draft, weekly: weekly([gradedSeven]) }));
	assert.deepEqual(after, {
		name: 'Weekly record',
		value: '0.62',
		pairs: [],
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
		RECORDS_WORDS.before(7),
		RECORDS_WORDS.pending(7),
		RECORDS_WORDS.pendingWhen('Wed Oct 28', 'Monday'),
		RECORDS_WORDS.pendingWhen(null, 'Monday'),
		RECORDS_WORDS.namedKey('12 QB, 24 RB'),
		RECORDS_WORDS.draftSet('Tue Sep 8'),
		RECORDS_WORDS.draftGraded(5),
		RECORDS_WORDS.draftGraded(null)
	];
	for (const words of said) {
		assert.doesNotMatch(words, bannedPattern(), words);
		assert.doesNotMatch(words, /\u2014/u, words);
	}
});

void test('before a week is graded the weekly record draws no figure: the week and when it grades (C04)', () => {
	const monday = '2026-10-27T00:15:00.000Z';
	const ahead = weeklyAsRecord(
		run({ weekly: weekly([upcoming(7, '2026-10-23T00:15:00.000Z')], []) })
	);
	assert.ok(ahead);
	assert.deepEqual(weeklyPending(ahead, { week: 7, lastKickoff: monday }), {
		title: 'Week 7 not graded yet',
		when: "Grades after Monday's game."
	});
	// A set week grades on the run's own day: its last kickoff and the grading pass's wait.
	const set: RecordWeek = {
		...gradedSeven,
		status: 'frozen',
		gradedAt: null,
		population: 0,
		lines: [],
		gradesFrom: '2026-10-28T12:15:00.000Z'
	};
	const frozen = weeklyAsRecord(run({ weekly: weekly([set], []) }));
	assert.ok(frozen);
	const pending = weeklyPending(frozen, { week: 7, lastKickoff: monday });
	assert.deepEqual(pending, {
		title: 'Week 7 not graded yet',
		when: "Grades Wed Oct 28 after Monday's game."
	});
	assert.ok(pending);
	assert.doesNotMatch(pending.title.replace(/^Week \d+/u, ''), /\d/u);
	assert.equal(
		weeklyPending(frozen, { week: 7, lastKickoff: null })?.when,
		'Grades when the stats land.'
	);
	const graded = weeklyAsRecord(run({ weekly: weekly([gradedSeven]) }));
	assert.ok(graded);
	assert.equal(weeklyPending(graded, { week: 8, lastKickoff: monday }), null);
	assert.equal(weeklyPending(ahead, null), null);
});

void test('the draft tiles say what top named counts and that places off is better lower (C17)', () => {
	const tops = (position: 'QB' | 'RB', of: number) => ({
		position,
		ours: { ...score(0.5, 1), startersOf: of },
		adp: { ...score(0.5, 1), startersOf: of }
	});
	assert.deepEqual(
		draftKeys({ ...draft, lines: [...draft.lines.slice(0, 1), tops('QB', 12), tops('RB', 24)] }),
		{
			agreement: null,
			placesOff: 'lower is better',
			starters: 'of the top 12 QB, 24 RB'
		}
	);
	const pairs = draftPairs({ position: 'All', ours: score(0.54, 53), adp: score(0.54, 56) });
	assert.equal(pairs.agreement.lead, 'level');
	assert.equal(pairs.agreement.leader, 'level');
	assert.equal(pairs.starters.lead, 'ADP by 3');
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
			['Week 7', 'set Thu Oct 22, 1:00 pm Central, graded Wed Oct 28'],
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
