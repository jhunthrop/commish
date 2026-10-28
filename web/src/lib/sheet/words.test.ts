// The cheat sheet's words under the one copy guard (Lane 283): no banned word or mark in any table the
// web and the apps print from, the status line's two built words included. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { PRINT_WORDS } from './print-words.ts';
import { SHEET, SHEET_IMPORT, SHEET_STATUS } from './words.ts';

/** Every word the tables print: their strings, and the status line's built words with a stamp. */
const SAID = [
	...[SHEET, SHEET_IMPORT, SHEET_STATUS, PRINT_WORDS].flatMap((table) =>
		Object.values(table).filter((word): word is string => typeof word === 'string')
	),
	SHEET_STATUS.savedAt('7:41 PM'),
	SHEET_STATUS.savedOn('Oct 13')
];

void test('every sheet word passes the copy guard', () => {
	for (const word of SAID) assert.doesNotMatch(word, bannedPattern(), word);
});

void test('the status line builds its two stamped words on the saved word', () => {
	assert.equal(SHEET_STATUS.savedAt('7:41 PM'), `${SHEET_STATUS.saved} at 7:41 PM`);
	assert.equal(SHEET_STATUS.savedOn('Oct 13'), `${SHEET_STATUS.saved} Oct 13`);
});
