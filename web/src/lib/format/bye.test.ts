// A bye on a rest-of-season board (Lane 140, C26): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayTimeStamp } from './day-time.ts';
import { byeAhead, byeCell, byeLine } from './bye.ts';
import { EMPTY_FIGURE } from './empty.ts';

void test('a bye before the week the board ranks from draws nothing (Lane 223), one ahead its week', () => {
	assert.equal(byeCell(6, 7), '');
	assert.equal(byeCell(7, 7), '7');
	assert.equal(byeCell(11, 7), '11');
});

void test('a board of the full season prints every bye, and none reads the empty figure', () => {
	assert.equal(byeCell(6, null), '6');
	assert.equal(byeCell(null, 7), EMPTY_FIGURE);
});

void test('a phone row says its bye ahead as Bye week N and nothing once it is played (Lane 209)', () => {
	assert.equal(byeLine(11, 7), 'Bye week 11');
	assert.equal(byeLine(7, 7), 'Bye week 7');
	assert.equal(byeLine(6, 7), null);
	assert.equal(byeLine(6, null), 'Bye week 6');
	assert.equal(byeLine(null, 7), null);
});

void test('a bye is ahead from the week the board ranks from, and never once played', () => {
	assert.equal(byeAhead(7, 7), 7);
	assert.equal(byeAhead(6, 7), null);
	assert.equal(byeAhead(6, null), 6);
	assert.equal(byeAhead(null, null), null);
});

void test('a stamp says its day, its time and its zone (C14, C24)', () => {
	assert.equal(
		dayTimeStamp('2026-10-22T07:38:00.000Z', 'America/Chicago'),
		'Thu Oct 22, 2:38 am Central'
	);
});
