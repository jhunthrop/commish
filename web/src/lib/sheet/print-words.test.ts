// The print sheet's words: an empty sheet gets one sentence and the way back, under the one copy
// guard. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { PRINT_WORDS } from './print-words.ts';

void test('an empty sheet says why there is nothing to print in one sentence, with the way back', () => {
	assert.equal(PRINT_WORDS.emptyLine.split(/[.!?](\s|$)/u).filter((s) => s.trim()).length, 1);
	assert.equal(PRINT_WORDS.back, 'Back to your sheet');
	for (const said of Object.values(PRINT_WORDS)) assert.doesNotMatch(said, bannedPattern(), said);
});
