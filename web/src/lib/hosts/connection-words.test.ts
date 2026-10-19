// The account page's words for a connected host: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import {
	ESPN_CONSENT,
	ESPN_CONSENT_VERSION,
	MFL_CONSENT,
	MFL_CONSENT_VERSION,
	statusWords
} from './connection-words.ts';

const at = '2026-10-15T12:00:00Z';

void test('a proven ESPN session reads connected', () => {
	const c = {
		host: 'espn',
		status: 'connected',
		proven: true,
		connected_at: at,
		last_read_at: null,
		consent_version: 3,
		writes_on: false,
		writes_reason: null
	} as const;
	assert.equal(statusWords(c), 'Connected');
});

void test('an ESPN session kept with only public leagues says it is not yet checked', () => {
	const c = {
		host: 'espn',
		status: 'connected',
		proven: false,
		connected_at: at,
		last_read_at: null,
		consent_version: 3,
		writes_on: false,
		writes_reason: null
	} as const;
	assert.equal(statusWords(c), 'Connected, not yet checked against a private league');
});

void test('a signed out session says whether ESPN ever accepted it', () => {
	const c = {
		host: 'espn',
		status: 'signed_out',
		proven: true,
		connected_at: at,
		last_read_at: null,
		consent_version: 3,
		writes_on: false,
		writes_reason: null
	} as const;
	assert.equal(statusWords(c), 'ESPN no longer accepts your saved sign-in');
	assert.equal(statusWords({ ...c, proven: false }), 'ESPN did not accept your saved sign-in');
	assert.equal(statusWords({ ...c, host: 'ffpc' }), 'Signed out by FFPC');
});

void test('the ESPN session sentence says what it is kept for, the moves the member asks for included', () => {
	assert.equal(
		ESPN_CONSENT,
		'We keep an encrypted copy of your ESPN session so your league stays in sync and, when you ask, to make your moves. Disconnect deletes it at once.'
	);
	assert.match(ESPN_CONSENT, /when you ask, to make your moves/);
	assert.equal(ESPN_CONSENT_VERSION, 3);
	assert.doesNotMatch(ESPN_CONSENT, bannedPattern());
});

void test('the MyFantasyLeague words say the password is never kept and name the lineup moves', () => {
	assert.equal(MFL_CONSENT_VERSION, 1);
	assert.match(MFL_CONSENT, /never keep it/);
	assert.match(MFL_CONSENT, /set your lineup there when you confirm a move/);
	assert.doesNotMatch(MFL_CONSENT, bannedPattern());
	const c = {
		host: 'mfl',
		status: 'signed_out',
		proven: true,
		connected_at: at,
		last_read_at: null,
		consent_version: 3,
		writes_on: false,
		writes_reason: null
	} as const;
	assert.equal(statusWords(c), 'MyFantasyLeague no longer accepts your saved sign-in');
});
