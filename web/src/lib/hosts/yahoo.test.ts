// Yahoo's return to the account page is one sentence: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { yahooOutcome } from './yahoo.ts';

void test('a connected return says so', () => {
	const out = yahooOutcome(new URLSearchParams('yahoo=connected'));
	assert.ok(out);
	assert.equal(out.connected, true);
	assert.equal(out.words, 'Yahoo is connected.');
});

void test('each refusal names why in one sentence of our words', () => {
	for (const why of ['denied', 'expired', 'signed_out', 'failed', 'off']) {
		const out = yahooOutcome(new URLSearchParams({ yahoo: 'refused', why }));
		assert.ok(out, why);
		assert.equal(out.connected, false);
		assert.doesNotMatch(out.words, bannedPattern());
	}
});

void test('an unknown why reads as a failure, and no outcome is null', () => {
	assert.equal(
		yahooOutcome(new URLSearchParams('yahoo=refused&why=strange'))?.words,
		yahooOutcome(new URLSearchParams('yahoo=refused&why=failed'))?.words
	);
	assert.equal(yahooOutcome(new URLSearchParams('')), null);
	assert.equal(yahooOutcome(new URLSearchParams('yahoo=elsewhere')), null);
});
