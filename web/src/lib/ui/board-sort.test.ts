// Sorting a board by a column (Lane 66n). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pressed, sortRows, type Sortable } from './board-sort.ts';

const row = (name: string, fields: Partial<Sortable>): Sortable & { name: string } => ({
	name,
	ourRank: 1,
	adp: 1,
	tier: 1,
	projected: 100,
	vor: 10,
	team: 'LAR',
	...fields
});

const ROWS = [
	row('Nacua', { ourRank: 1, adp: 2.8, projected: 344.1, vor: 164, team: 'LAR' }),
	row('Chase', { ourRank: 2, adp: 3.8, projected: 333.2, vor: 153.2, team: 'CIN' }),
	row('Gibbs', { ourRank: 5, adp: 1.4, projected: 262.1, vor: 113.9, team: 'DET' }),
	row('Mingo', { ourRank: 425, adp: null, projected: 35.6, vor: -144.5, team: 'DAL' })
];
const BYES = { LAR: 11, CIN: 6, DET: 6, DAL: 14 };
const names = (rows: readonly { name: string }[]): string[] => rows.map((r) => r.name);

void test('a rank or an ADP sorts up, a figure down, a missing ADP last', () => {
	assert.deepEqual(names(sortRows(ROWS, { key: 'adp', turned: false }, BYES)), [
		'Gibbs',
		'Nacua',
		'Chase',
		'Mingo'
	]);
	assert.deepEqual(names(sortRows(ROWS, { key: 'proj', turned: false }, BYES)), [
		'Nacua',
		'Chase',
		'Gibbs',
		'Mingo'
	]);
});

void test('the gap sorts the biggest wait first, and turned the biggest reach', () => {
	// Gaps: Nacua +2, Chase +2, Gibbs -4, Mingo none.
	assert.deepEqual(names(sortRows(ROWS, { key: 'gap', turned: false }, BYES)), [
		'Nacua',
		'Chase',
		'Gibbs',
		'Mingo'
	]);
	assert.deepEqual(names(sortRows(ROWS, { key: 'gap', turned: true }, BYES)), [
		'Gibbs',
		'Nacua',
		'Chase',
		'Mingo'
	]);
});

void test('the bye sorts by the club, ties in the page order', () => {
	assert.deepEqual(names(sortRows(ROWS, { key: 'bye', turned: false }, BYES)), [
		'Chase',
		'Gibbs',
		'Nacua',
		'Mingo'
	]);
});

void test('a second press turns the sort, a new column starts in its own direction', () => {
	assert.deepEqual(pressed({ key: 'rank', turned: false }, 'rank'), { key: 'rank', turned: true });
	assert.deepEqual(pressed({ key: 'rank', turned: true }, 'vor'), { key: 'vor', turned: false });
});

void test('sorting returns a new array and leaves the rows alone', () => {
	const before = names(ROWS);
	sortRows(ROWS, { key: 'vor', turned: true }, BYES);
	assert.deepEqual(names(ROWS), before);
});
