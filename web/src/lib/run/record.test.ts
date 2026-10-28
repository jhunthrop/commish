// The record box score's words (Lane 66j fix round 1): run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import {
	RECORD_WORDS,
	chartSeries,
	chartWeeks,
	gapWords,
	standingWords,
	weekLines,
	weekOrderWords,
	chartTicks,
	publishedDrawn,
	recordBasis,
	recordLead,
	recordSources,
	RECORD_AFTER,
	RECORD_BEFORE,
	RECORD_FIGURES,
	recordStatusSpans,
	figureWords,
	gradedOrders,
	printPlaces,
	besideOf,
	publishedWords,
	recordHeadline
} from './record.ts';
import type { RecordLine, RecordWeek, RunRecord } from './schema.ts';

const week = (n: number, order: RecordWeek['order'], status: RecordWeek['status']): RecordWeek => ({
	week: n,
	status,
	frozenAt: order === null ? null : '2026-09-08T12:00:00.000Z',
	frozenBy: order === null ? null : '2026-10-14T04',
	order,
	gradedAt: status === 'graded' ? '2026-10-14T04:36:03.983Z' : null,
	population: 0,
	lines: []
});

const record = (over: Partial<RunRecord>): RunRecord => ({
	season: 2026,
	format: 'ppr-12',
	statistic: { agreement: 'order matched', placesOff: 'places off', starters: 'starters right' },
	scale: "1.00 is a perfect match of the week's finishing order, 0.00 is none.",
	startersBasis: null,
	method: 'Graded against our preseason board.',
	publishedFromWeek: null,
	honest: null,
	weeks: [],
	toDate: [],
	...over
});

const SCORE = { graded: 10, agreement: 0.5, placesOff: 43, starters: 50, startersOf: 84 };
const line = (published: boolean): RecordLine => ({
	position: 'All',
	ours: SCORE,
	adp: { ...SCORE, agreement: 0.41 },
	published: published ? { ...SCORE, agreement: 0.55 } : null,
	oursOnPublished: published ? SCORE : null,
	espn: null,
	oursOnEspn: null
});
const gradedWeek = (n: number, published: boolean): RecordWeek => ({
	...week(n, 'preseason', 'graded'),
	lines: [line(published)]
});
/** Six graded weeks with Published kept from week 7 and not yet graded: live's shape (Lane 82). */
const beforePublished = record({
	publishedFromWeek: 7,
	weeks: [1, 2, 3, 4, 5, 6].map((n) => gradedWeek(n, false)),
	toDate: [line(false)]
});
const withPublished = record({
	publishedFromWeek: 7,
	weeks: [...beforePublished.weeks, gradedWeek(7, true)],
	toDate: [line(true)]
});

void test('Published is drawn only once a graded week carries it (the honest empty state)', () => {
	assert.equal(publishedDrawn(record({})), false);
	assert.equal(publishedDrawn(beforePublished), false);
	assert.equal(publishedDrawn(withPublished), true);
	assert.deepEqual(recordSources(beforePublished), ['ours', 'adp']);
	assert.deepEqual(recordSources(withPublished), ['ours', 'adp', 'published']);
	assert.deepEqual(Object.keys(chartSeries(beforePublished, 'All')), ['ours', 'adp']);
	assert.equal(chartSeries(withPublished, 'All').published?.length, 1);
});

void test('the lead names only the orders drawn, and says we set the order', () => {
	assert.equal(
		recordLead(beforePublished, 'PPR'),
		"How the order we set before each week's kickoff called its games, beside ADP, graded in PPR"
	);
	assert.equal(
		recordLead(withPublished, 'PPR'),
		"How the order we set before each week's kickoff called its games, beside ADP and the week's published projection, graded in PPR"
	);
});

void test('Published names the week it starts only once a set order kept it, as a plain rule (B04, review M3, Lane 140 C16)', () => {
	const from7 =
		"From week 7 the week's published projection is graded beside ours on the same players.";
	assert.equal(publishedWords(beforePublished), from7);
	const promise =
		"The week's published projection is graded beside ours from the first week we read it before setting our order.";
	const upcoming = record({ weeks: [gradedWeek(1, false), week(2, null, 'upcoming')] });
	assert.equal(publishedWords(upcoming), promise, 'never the next week, renewed each week');
	assert.equal(publishedWords(record({})), promise);
	assert.equal(
		publishedWords(withPublished),
		"From week 7 the week's published projection (Published) is graded beside ours on the same players."
	);
});

void test('the basis defines each measure once and a league replaces the starters sentence', () => {
	const run = { ...beforePublished, startersBasis: 'Starters right counts the top 12 QBs.' };
	// A run's own record says its figures' sentences alone (Lane 131): the season-long rule and
	// Published's start are the weekly record's desk words, and the lead names Published once drawn.
	assert.deepEqual(recordBasis(run), [
		run.method,
		run.scale,
		RECORD_WORDS.placesOff,
		'Starters right counts the top 12 QBs.'
	]);
	assert.equal(
		recordBasis({ ...withPublished, startersBasis: null }).at(-1),
		RECORD_WORDS.placesOff
	);
	assert.match(recordLead(withPublished, 'PPR'), /the week's published projection/u);
	const league = { starters: 'In your lineup.', benchmark: 'ESPN too.' };
	assert.deepEqual(recordBasis(run, league).slice(-2), ['In your lineup.', 'ESPN too.']);
	assert.equal(recordBasis(record({})).length, 3, 'no starters sentence with no week graded');
	for (const sentence of [...recordBasis(beforePublished), ...recordBasis(withPublished)]) {
		assert.doesNotMatch(sentence, bannedPattern());
		assert.doesNotMatch(sentence, /Rates print|froze|freeze/u);
	}
});

const missedWeek = (n: number): RecordWeek => ({
	...week(n, null, 'missed'),
	note: 'Our order was not set before kickoff that week.'
});
const waitingWeek: RecordWeek = {
	...week(6, 'preseason', 'frozen'),
	frozenAt: '2026-10-13T07:34:34.762Z',
	gradesFrom: '2026-10-21T12:15:00.000Z'
};
/** Monday night of week 6 (B03): weeks 1 and 2 graded, 3 to 5 missed, 6 set and waiting. */
const mondayNight = record({
	weeks: [
		gradedWeek(1, false),
		gradedWeek(2, false),
		missedWeek(3),
		missedWeek(4),
		missedWeek(5),
		waitingWeek
	],
	toDate: [line(false)]
});

void test('the headline says how many played weeks are graded and why the rest are not (B03)', () => {
	const missed = 'Weeks 3 to 5 were not set before kickoff, so they cannot be graded.';
	assert.equal(standingWords(mondayNight), 'Graded 2 of 5 weeks played');
	assert.equal(
		gapWords(mondayNight),
		`${missed} Week 6 grades once every game's stats are in, usually Wednesday.`
	);
	const undated: RecordWeek = { ...waitingWeek, gradesFrom: undefined };
	assert.equal(
		gapWords(record({ weeks: [undated], toDate: [line(false)] })),
		"Week 6 grades once every game's stats are in."
	);
	assert.equal(gapWords(mondayNight, [6]), missed);
	// A drawn "when" line says the rule for its week, so the gap sentence drops it (B260).
	assert.equal(gapWords(mondayNight, [], 6), missed);
	const headline = recordHeadline(mondayNight);
	assert.equal(headline.standing, 'Graded 2 of 5 weeks played');
	assert.deepEqual(headline.starters, { value: '50 of 84', caption: 'ADP 50 of 84' });
	assert.equal(standingWords(record({})), null);
});

void test('every week says set, then graded, in one order (B37)', () => {
	assert.deepEqual(
		weekLines(mondayNight.weeks).map((l) => `${l.lead}: ${l.text}`),
		[
			'Week 1: set Tue Sep 8, graded Wed Oct 14',
			'Week 2: set Tue Sep 8, graded Wed Oct 14',
			'Weeks 3 to 5: our order was not set before kickoff, so they cannot be graded',
			"Week 6: set Tue Oct 13, grades once every game's stats are in, usually Wed Oct 21"
		]
	);
	assert.equal(weekLines([waitingWeek], [6])[0]?.text, 'set Tue Oct 13, not played yet');
	const ahead: RecordWeek = { ...week(7, null, 'upcoming'), frozenAt: '2026-10-23T00:15:00.000Z' };
	assert.equal(weekLines([ahead])[0]?.text, 'set before kickoff Thu Oct 22');
});

void test('a week names the order it graded with its refresh (B18)', () => {
	const shipped: RecordWeek = {
		...week(7, 'rest_of_season', 'graded'),
		orderAsOf: '2026-10-22T09:00:00.000Z'
	};
	assert.equal(weekOrderWords(shipped), 'Our rest-of-season order, refreshed Oct 22');
	assert.equal(weekOrderWords(week(1, 'preseason', 'graded')), 'Our preseason order');
	assert.equal(weekOrderWords(week(3, null, 'missed')), null);
});

void test('the chart draws the graded weeks alone (B45)', () => {
	assert.deepEqual(chartWeeks(mondayNight), [1, 2]);
});

void test('the chart axis prints as the rates print, 0.00 to 1.00, and reaches a week below zero', () => {
	assert.deepEqual(
		chartTicks([0.49, 0.38]).map((t) => t.label),
		['0.00', '0.25', '0.50', '0.75', '1.00']
	);
	assert.deepEqual(
		chartTicks([-0.09, 0.2]).map((t) => t.label),
		['-0.25', '0.00', '0.25', '0.50', '0.75', '1.00']
	);
});

void test('the bug names the orders the graded weeks graded', () => {
	const weeks = [
		week(1, 'preseason', 'graded'),
		week(2, 'preseason', 'graded'),
		week(6, 'preseason', 'frozen')
	];
	assert.equal(gradedOrders(record({ weeks })), 'Our preseason order');
	const both = [...weeks, week(7, 'rest_of_season', 'graded')];
	assert.equal(
		gradedOrders(record({ weeks: both })),
		'Our preseason order, then our rest-of-season order'
	);
});

void test('a rate in [0, 1] prints two decimals as given, with no word about decimals (ruling R2, Lane 93)', () => {
	const score = { graded: 10, agreement: 0.48, placesOff: 43, starters: 50, startersOf: 84 };
	const graded = record({
		weeks: [week(1, 'preseason', 'graded')],
		toDate: [
			{
				position: 'All',
				ours: score,
				adp: { ...score, agreement: 0.37 },
				published: null,
				oursOnPublished: null,
				espn: null,
				oursOnEspn: null
			}
		]
	});
	const headline = recordHeadline(graded);
	assert.equal(headline.value, '0.48');
	assert.ok(headline.caption.includes('ADP 0.37 on the same players'), headline.caption);
	assert.doesNotMatch(headline.caption, /decimals/u);
	assert.equal(printPlaces(0.483, 2), '0.483', 'never rounded again');
});

void test('a figure prints as the run gives it', () => {
	const score = { graded: 10, agreement: 0.5, placesOff: 43, starters: 50, startersOf: 84 };
	assert.equal(figureWords(score, 'agreement'), '0.50');
	assert.equal(figureWords(score, 'placesOff'), '43.0');
	assert.equal(printPlaces(-0.49, 2), '-0.49');
	assert.equal(printPlaces(9.5, 1), '9.5');
	assert.equal(figureWords(score, 'starters'), '50 of 84');
	assert.equal(figureWords(null, 'starters'), '--');
});

void test('the published figure to date stands beside ours over the weeks that graded it', () => {
	const score = { graded: 10, agreement: 0.5, placesOff: 43, starters: 50, startersOf: 84 };
	const line = {
		position: 'All' as const,
		ours: { ...score, agreement: 0.62 },
		adp: score,
		published: { ...score, agreement: 0.55 },
		oursOnPublished: { ...score, agreement: 0.48 },
		espn: { ...score, agreement: 0.58 },
		oursOnEspn: { ...score, agreement: 0.6 }
	};
	assert.deepEqual(besideOf(line, 'published', 'agreement'), { value: '0.55', ours: 'Ours 0.48' });
	assert.deepEqual(besideOf(line, 'espn', 'agreement'), { value: '0.58', ours: 'Ours 0.60' });
	assert.deepEqual(besideOf(line, 'adp', 'agreement'), { value: '0.50', ours: null });
	assert.deepEqual(besideOf({ ...line, oursOnPublished: null }, 'published', 'agreement'), {
		value: '0.55',
		ours: null
	});
	assert.deepEqual(besideOf(undefined, 'published', 'agreement'), { value: '--', ours: null });
});

void test('a row not graded spans the columns each width draws, so no track is left empty', () => {
	// Desk: Players, the three figures for each order and Status. Narrow: the shown figure's orders.
	assert.deepEqual(recordStatusSpans(2), { desk: 8, narrow: 2 });
	assert.deepEqual(recordStatusSpans(3), { desk: 11, narrow: 3 });
	const page = readFileSync(
		new URL('../../routes/(run)/record/WeeklySection.svelte', import.meta.url),
		'utf8'
	);
	assert.match(page, /class="st wide desk" colspan=\{spans\.desk\}/);
	assert.match(page, /class="st wide narrow" colspan=\{spans\.narrow\}/);
	assert.match(page, /<td class="st"><\/td>/, "the To date row's last cell hides with Status");
});

void test('the status spans come from the column lists the table draws, never a hand count', () => {
	const drawn = (list: readonly { narrow: boolean }[], narrow: boolean): number =>
		list.filter((c) => !narrow || c.narrow).length;
	for (const n of [2, 3]) {
		assert.deepEqual(recordStatusSpans(n), {
			desk: drawn(RECORD_BEFORE, false) + RECORD_FIGURES.length * n + drawn(RECORD_AFTER, false),
			narrow: drawn(RECORD_BEFORE, true) + n + drawn(RECORD_AFTER, true)
		});
	}
	const page = readFileSync(
		new URL('../../routes/(run)/record/WeeklySection.svelte', import.meta.url),
		'utf8'
	);
	assert.match(page, /\{#each RECORD_BEFORE as column/);
	assert.match(page, /\{#each RECORD_AFTER as column/);
	assert.doesNotMatch(page, /colspan="2"/);
});
