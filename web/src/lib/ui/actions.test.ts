// A strip's actions: the first, or the chosen, is the one solid verb, every other the quiet outline
// in the same words (Lane 83: one orange verb per strip). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVariant } from './actions.ts';

void test('the lead of a strip is its verb, every other action quiet', () => {
	assert.equal(stripVariant(true), 'verb');
	assert.equal(stripVariant(false), 'quiet');
});

void test('a strip of cards draws exactly one verb, its first', () => {
	const variants = [0, 1, 2].map((index) => stripVariant(index === 0));
	assert.deepEqual(variants, ['verb', 'quiet', 'quiet']);
});
