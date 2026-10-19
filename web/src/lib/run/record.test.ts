// The record box score's words (Lane 66j fix round 1): run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import {
	HELD_OUT_METHOD,
	RATE_PLACES_WORDS,
	chartSeries,
	chartTicks,
	publishedDrawn,
	recordBasis,
	recordLead,
	recordSources,
	RECORD_AFTER,
	RECORD_BEFORE,
	RECORD_FIGURES,
	recordStatusSpans,
	scaleWords,
	figureWords,
	gradedOrders,
	printPlaces,
	publishedBeside,
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
	oursOnPublished: published ? SCORE : null
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

void test('the lead names only the orders drawn', () => {
	assert.equal(
		recordLead(beforePublished, 'PPR'),
		'How the order we froze each week called its games, beside ADP, graded in PPR'
	);
	assert.equal(
		recordLead(withPublished, 'PPR'),
		'How the order we froze each week called its games, beside ADP and a published projection, graded in PPR'
	);
});

void test('Published says when it starts until it is drawn, from publishedFromWeek', () => {
	assert.equal(
		publishedWords(beforePublished),
		"Published, one provider's weekly projection, starts with week 7."
	);
	assert.equal(
		publishedWords(record({})),
		"Published, one provider's weekly projection, starts once our register keeps it."
	);
	assert.equal(
		publishedWords(withPublished),
		"Published is one provider's weekly projection, from week 7."
	);
});

void test('the basis is the run method, the season-long rule, the starters and Published, no capture', () => {
	const run = { ...beforePublished, startersBasis: 'Starters right counts the top 12 QBs.' };
	assert.deepEqual(recordBasis(run), [
		run.method,
		HELD_OUT_METHOD,
		'Starters right counts the top 12 QBs.',
		"Published, one provider's weekly projection, starts with week 7."
	]);
	assert.equal(recordBasis(record({})).length, 3, 'no starters sentence before a grade');
	assert.match(HELD_OUT_METHOD, /graded where the board froze\.$/u);
	for (const sentence of [...recordBasis(beforePublished), ...recordBasis(withPublished)])
		assert.doesNotMatch(sentence, bannedPattern());
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

void test('a rate in [0, 1] prints two decimals as given, and the headline says so once with its scale (ruling R2, Lane 66t)', () => {
	const score = { graded: 10, agreement: 0.48, placesOff: 43, starters: 50, startersOf: 84 };
	const graded = record({
		weeks: [week(1, 'preseason', 'graded')],
		toDate: [
			{
				position: 'All',
				ours: score,
				adp: { ...score, agreement: 0.37 },
				published: null,
				oursOnPublished: null
			}
		]
	});
	const headline = recordHeadline(graded);
	assert.equal(headline.value, '0.48');
	assert.ok(headline.caption.includes('ADP 0.37 on the same players'), headline.caption);
	assert.ok(headline.caption.endsWith(RATE_PLACES_WORDS), headline.caption);
	assert.equal(headline.caption.split(RATE_PLACES_WORDS).length, 2, 'said once');
	assert.equal(printPlaces(0.483, 2), '0.483', 'never rounded again');
	// The graded page says the scale and the two decimals once, under the bug's tiles (Lane 66t).
	assert.equal(
		scaleWords(graded),
		"Order matched: 1.00 is a perfect match of the week's finishing order, 0.00 is none. Rates print to two decimals."
	);
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
		oursOnPublished: { ...score, agreement: 0.48 }
	};
	assert.deepEqual(publishedBeside(line, 'agreement'), { published: '0.55', ours: 'Ours 0.48' });
	assert.deepEqual(publishedBeside({ ...line, oursOnPublished: null }, 'agreement'), {
		published: '0.55',
		ours: null
	});
	assert.deepEqual(publishedBeside(undefined, 'agreement'), { published: '--', ours: null });
});

void test('a row not graded spans the columns each width draws, so no track is left empty', () => {
	// Desk: Players, the three figures for each order and Status. Narrow: the shown figure's orders.
	assert.deepEqual(recordStatusSpans(2), { desk: 8, narrow: 2 });
	assert.deepEqual(recordStatusSpans(3), { desk: 11, narrow: 3 });
	const page = readFileSync(
		new URL('../../routes/(run)/record/+page.svelte', import.meta.url),
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
		new URL('../../routes/(run)/record/+page.svelte', import.meta.url),
		'utf8'
	);
	assert.match(page, /\{#each RECORD_BEFORE as column/);
	assert.match(page, /\{#each RECORD_AFTER as column/);
	assert.doesNotMatch(page, /colspan="2"/);
});
