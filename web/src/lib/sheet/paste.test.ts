// A pasted list finds a kicker by his name and a defense by its name or its club (Lane 66m): the
// shapes a ranking copied from anywhere writes them in. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SheetPlayer } from './model.ts';
import { nameIndex, readList } from './paste.ts';

const BOARD: SheetPlayer[] = [
	{ id: '4429795', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', headshot: null },
	{ id: '3055899', name: 'Brandon Aubrey', position: 'K', team: 'DAL', headshot: null },
	{ id: 'DST-BUF', name: 'Buffalo Bills', position: 'DST', team: 'BUF', headshot: null },
	{ id: 'DST-KC', name: 'Kansas City Chiefs', position: 'DST', team: 'KC', headshot: null },
	{ id: 'DST-LAR', name: 'Los Angeles Rams', position: 'DST', team: 'LAR', headshot: null },
	{ id: 'DST-LAC', name: 'Los Angeles Chargers', position: 'DST', team: 'LAC', headshot: null }
];

/** The player one pasted line finds, or the reason it was skipped. */
function found(line: string): string {
	const read = readList(line, nameIndex(BOARD));
	return read.rows[0]?.id ?? read.skipped[0]?.reason ?? 'nothing';
}

void test('a kicker is found by his name, with or without his position', () => {
	assert.equal(found('Brandon Aubrey'), '3055899');
	assert.equal(found('Brandon Aubrey, K'), '3055899');
	assert.equal(found('7. Brandon Aubrey (PK, DAL)'), '3055899');
});

void test('a defense is found by its name, its club, its nickname or its city', () => {
	for (const line of [
		'Buffalo Bills',
		'Bills D/ST',
		'BUF DST',
		'Buffalo Defense',
		'Bills, DEF',
		'14. BUF D/ST',
		'Bills'
	]) {
		assert.equal(found(line), 'DST-BUF', line);
	}
	assert.equal(found('Chiefs D/ST'), 'DST-KC');
	assert.equal(found('Kansas City Chiefs DST'), 'DST-KC');
	assert.equal(found('KC'), 'DST-KC');
});

void test('a city two clubs share is never guessed', () => {
	assert.equal(found('Los Angeles D/ST'), 'Two clubs share this city. Write the club, like LAR');
	assert.equal(found('Rams D/ST'), 'DST-LAR');
	assert.equal(found('LAC DST'), 'DST-LAC');
});

void test('a skill player is still found as before', () => {
	assert.equal(found('Jahmyr Gibbs, RB'), '4429795');
	assert.equal(found('Gibbs'), 'No player on our board has this name');
});
