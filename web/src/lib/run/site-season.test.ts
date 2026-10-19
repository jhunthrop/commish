// The site's season at build, from the run's kickoffs (spec 2026-10-16 §1, §2 first paint). Run with
// `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { siteSeason } from './site-season.ts';

/** Week 1's first kickoff and the last regular-season game of a season, out of order. */
const KICKOFFS = [
	'2026-09-13T17:00:00.000Z',
	'2026-09-10T00:20:00.000Z',
	'2027-01-10T21:25:00.000Z',
	'2026-10-18T17:00:00.000Z'
];

const at = (iso: string): string => siteSeason(new Date(iso), KICKOFFS);

void test('before week 1 kicks off the site is in its preseason', () => {
	assert.equal(at('2026-08-01T12:00:00.000Z'), 'preseason');
	assert.equal(at('2026-09-10T00:19:59.000Z'), 'preseason');
});

void test('from the first kickoff to the end of the last game day, Eastern, the site is in season', () => {
	assert.equal(at('2026-09-10T00:20:00.000Z'), 'in_season');
	assert.equal(at('2026-10-15T12:00:00.000Z'), 'in_season');
	// The last game day is Sunday January 10 on the Eastern clock: in season to its last second.
	assert.equal(at('2027-01-11T04:59:59.000Z'), 'in_season');
	assert.equal(at('2027-01-11T05:00:00.000Z'), 'playoffs');
});

void test('the playoffs run to the end of Super Bowl day, five weeks on, then the offseason', () => {
	assert.equal(at('2027-02-14T23:30:00.000Z'), 'playoffs');
	assert.equal(at('2027-02-15T04:59:59.000Z'), 'playoffs');
	assert.equal(at('2027-02-15T05:00:00.000Z'), 'offseason');
	assert.equal(at('2027-06-01T12:00:00.000Z'), 'offseason');
});

void test('a run with no kickoffs fails the build, naming why', () => {
	assert.throws(() => siteSeason(new Date('2026-10-17T17:00:00.000Z'), []), /no kickoffs/);
});
