// The league rows' short status words (Lane 268): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACK_WORD, returningShort } from './short-status.ts';

void test("a tight row's return word: the weekday this week, the day for a list's later return", () => {
	assert.equal(BACK_WORD, 'Back');
	assert.equal(returningShort('2026-10-18', true), 'Back Sun');
	assert.equal(returningShort('2026-11-08', false), 'Back Nov 8');
});
