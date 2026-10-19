// The record box score's words (Lane 66j fix round 1): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	RATE_PLACES_WORDS,
	scaleWords,
	figureWords,
	gradedOrders,
	printPlaces,
	publishedBeside,
	publishedWords,
	recordHeadline
} from './record.ts';
import type { RecordWeek, RunRecord } from './schema.ts';

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
	scale: "1.0 is a perfect match of the week's finishing order, 0 is none.",
	startersBasis: null,
	method: 'Graded against our preseason board.',
	publishedFromWeek: null,
	honest: null,
	weeks: [],
	toDate: [],
	...over
});

void test('the published columns say from which week they count, as the register says', () => {
	assert.match(
		publishedWords(record({})),
		/^Published is one provider's weekly projection, -- until our register first keeps it\.$/
	);
	assert.match(
		publishedWords(record({ publishedFromWeek: 7 })),
		/^Published is one provider's weekly projection, graded from week 7, -- before\.$/
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
		"Order matched: 1.0 is a perfect match of the week's finishing order, 0 is none. Rates print to two decimals."
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
