// The account page's words for a connected host: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESPN_CONSENT, statusWords } from './connection-words.ts';

const at = '2026-10-15T12:00:00Z';

void test('a proven ESPN session reads connected', () => {
	const c = {
		host: 'espn',
		status: 'connected',
		proven: true,
		connected_at: at,
		last_read_at: null
	} as const;
	assert.equal(statusWords(c), 'Connected');
});

void test('an ESPN session kept with only public leagues says it is not yet checked', () => {
	const c = {
		host: 'espn',
		status: 'connected',
		proven: false,
		connected_at: at,
		last_read_at: null
	} as const;
	assert.equal(statusWords(c), 'Connected, not yet checked against a private league');
});

void test('a signed out session says so whether or not it was proven', () => {
	const c = {
		host: 'espn',
		status: 'signed_out',
		proven: false,
		connected_at: at,
		last_read_at: null
	} as const;
	assert.equal(statusWords(c), 'ESPN no longer accepts your saved sign-in');
	assert.equal(statusWords({ ...c, host: 'ffpc', proven: true }), 'Signed out by FFPC');
});

void test('the ESPN session sentence says what it is kept for and makes no promise about moves', () => {
	assert.equal(
		ESPN_CONSENT,
		'We keep an encrypted copy of your ESPN session so your league stays in sync. Disconnect deletes it at once.'
	);
	assert.doesNotMatch(ESPN_CONSENT, /move|;|—/);
});
