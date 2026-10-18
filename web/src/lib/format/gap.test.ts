// The Gap's one text and tone (Lane 66n): the run's tenth printed as given, a true minus, a plain zero,
// green on plus and rose on minus. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gapText, gapTone } from './gap.ts';

void test('the gap prints the run tenth as given, with a true minus and a plain zero', () => {
	assert.equal(gapText(1.8), '+1.8');
	assert.equal(gapText(-4.5), '−4.5');
	assert.equal(gapText(-0.5), '−0.5');
	assert.equal(gapText(0), '0.0');
	assert.equal(gapText(null), '');
	assert.equal(gapText(undefined), '');
});

void test('plus is green, minus is rose, zero and none are neither', () => {
	assert.equal(gapTone(3.5), 'gain');
	assert.equal(gapTone(-0.5), 'loss');
	assert.equal(gapTone(0), 'even');
	assert.equal(gapTone(null), null);
});
