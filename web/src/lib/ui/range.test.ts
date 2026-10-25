// The range bar's one rule and the scale a list's bars share (Lane 210). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spanWords } from '#lib/format/number.ts';
import { rangePercent, sharedScale } from './range.ts';

void test('a point falls on the bar as a percent of its width, clamped to the bar', () => {
	const scale = { lo: 100, hi: 300 };
	assert.equal(rangePercent(100, scale), 0);
	assert.equal(rangePercent(200, scale), 50);
	assert.equal(rangePercent(350, scale), 100);
	assert.equal(rangePercent(50, scale), 0);
	assert.throws(() => rangePercent(1, { lo: 5, hi: 5 }), RangeError);
});

void test('the bars in a list share the lowest floor to the highest ceiling, none with no range', () => {
	assert.deepEqual(
		sharedScale([
			{ floor: 185.2, ceiling: 362.3 },
			{ floor: 174.7, ceiling: 321.7 }
		]),
		{ lo: 174.7, hi: 362.3 }
	);
	assert.equal(sharedScale([]), null);
	assert.equal(spanWords(212.3, 407.25), '212.3 to 407.3');
});
