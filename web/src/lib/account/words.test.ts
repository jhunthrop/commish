// The account's draft prep in season (B52, Lane 105 fix round 1): the draft tools recede from the
// first kickoff through the NFL playoffs, the rail's own season, and return at the offseason and
// the preseason. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftToolsRecede } from './words.ts';

void test('the draft tools recede in the regular season and the NFL playoffs', () => {
	assert.equal(draftToolsRecede({ phase: 'in_season' }), true);
	assert.equal(draftToolsRecede({ phase: 'playoffs' }), true);
});

void test('the draft tools return in the offseason and the preseason', () => {
	assert.equal(draftToolsRecede({ phase: 'offseason' }), false);
	assert.equal(draftToolsRecede({ phase: 'preseason' }), false);
});
