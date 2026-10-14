// The follow verb and the pool's words: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followVerb } from './follow-many.ts';
import { projectionWords } from './model.ts';

void test('the verb is singular when one league is chosen or only one can be', () => {
	assert.equal(followVerb(0, 1), 'Follow my league');
	assert.equal(followVerb(1, 20), 'Follow my league');
	assert.equal(followVerb(2, 20), 'Follow my leagues');
	assert.equal(followVerb(0, 20), 'Follow my leagues');
});

void test('a depth-floor projection is said in words, not as a measured number', () => {
	assert.equal(
		projectionWords({ points: 86, vor: -54.5, belowDepth: true }),
		"below our board's depth"
	);
	assert.equal(projectionWords({ points: 288, vor: 61 }), 'proj 288, over repl +61');
});
