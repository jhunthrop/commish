// Compare's own words: one sentence for each empty side in the call's verb, none once both are
// picked, and the failure sentence, under the one copy guard. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { COMPARE_FAILED, firstStep } from './compare-words.ts';
import { verdict } from './verdict.ts';

const side = (id: string, name: string, ourRank: number) => ({
	id,
	name,
	ourRank,
	vor: 100 - ourRank,
	held: null
});

void test('with nothing chosen the page says what to do, with one chosen what is left', () => {
	assert.equal(
		firstStep(0),
		'Pick two players to see which one we would take, with their figures side by side.'
	);
	assert.equal(firstStep(1), 'Pick a second player to set beside the first.');
	assert.equal(firstStep(2), null);
	for (const said of [firstStep(0) ?? '', firstStep(1) ?? '', COMPARE_FAILED])
		assert.doesNotMatch(said, bannedPattern(), said);
});

void test('the first step and the call use one verb, take', () => {
	const call = verdict(side('1', 'Puka Nacua', 1), side('2', "Ja'Marr Chase", 2), 'PPR');
	assert.ok(call.kind === 'call' && call.call.startsWith('We would take'));
	assert.match(firstStep(0) ?? '', /\bwe would take\b/);
});
