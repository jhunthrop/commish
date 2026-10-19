// Compare's first step: one sentence for each empty side, none once both are picked, under the one
// copy guard. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { firstStep } from './compare-words.ts';

void test('with nothing chosen the page says what to do, with one chosen what is left', () => {
	assert.equal(
		firstStep(0),
		'Pick two players to see which one we draft, with their figures side by side.'
	);
	assert.equal(firstStep(1), 'Pick a second player to set beside the first.');
	assert.equal(firstStep(2), null);
	for (const said of [firstStep(0), firstStep(1)]) {
		assert.ok(said !== null);
		assert.doesNotMatch(said, bannedPattern(), said);
	}
});
