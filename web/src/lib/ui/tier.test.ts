// The tier ramp (Lane 102, B47): one ink ramp, tier 1 the full ink, never wrapping. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TIER_HUES, tierColor, tierInk } from './tier.ts';

void test('each tier takes its own step, tier 1 the first', () => {
	assert.equal(tierColor(1), 'var(--tier-1)');
	assert.equal(tierInk(1), 'var(--tier-ink-1)');
	assert.equal(tierColor(TIER_HUES), `var(--tier-${String(TIER_HUES)})`);
});

void test('the ramp never wraps: tiers past the last step share the lightest ink (fix round 1, HIGH-2)', () => {
	const last = `var(--tier-${String(TIER_HUES)})`;
	assert.equal(tierColor(8), last);
	assert.equal(tierColor(14), last);
	assert.equal(tierInk(14), `var(--tier-ink-${String(TIER_HUES)})`);
	assert.notEqual(tierColor(8), tierColor(1));
});

void test('a tier is a whole number from 1', () => {
	assert.throws(() => tierColor(0), RangeError);
	assert.throws(() => tierInk(1.5), RangeError);
});
