// A bye on a rest-of-season board (Lane 140, C26): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayTimeStamp } from './day-time.ts';
import { BYE_WORDS, byeCell } from './bye.ts';
import { EMPTY_FIGURE } from './empty.ts';

void test('a bye before the week the board ranks from reads Done, one ahead its week', () => {
	assert.equal(byeCell(6, 7), BYE_WORDS.done);
	assert.equal(byeCell(7, 7), '7');
	assert.equal(byeCell(11, 7), '11');
});

void test('a board of the full season prints every bye, and none reads the empty figure', () => {
	assert.equal(byeCell(6, null), '6');
	assert.equal(byeCell(null, 7), EMPTY_FIGURE);
});

void test('a stamp says its day, its time and its zone (C14, C24)', () => {
	assert.equal(
		dayTimeStamp('2026-10-22T07:38:00.000Z', 'America/Chicago'),
		'Thu Oct 22, 2:38 am Central'
	);
});
