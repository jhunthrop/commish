// Disney's sign-in hands the page a session somewhere in what it answers, and the page reads the
// window's every message for what Disney did: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESPN_SIGN_IN_ORIGIN, SITE_ORIGIN } from '../site/origins.ts';
import { fromSignInWindow, readMessage } from './espn-oneid.ts';
import { findSession } from './espn-session.ts';

const S2 = 'AEB'.repeat(30);

void test('the two values are found by name at any depth, the SWID braced', () => {
	const login = {
		token: { access_token: 'x', swid: '00000001-0000-4000-8000-000000000001' },
		guest: { profile: { name: 'm' }, s2: S2 }
	};
	assert.deepEqual(findSession(login), {
		swid: '{00000001-0000-4000-8000-000000000001}',
		s2: S2
	});
});

void test('a payload missing either value hands over nothing', () => {
	assert.equal(findSession({ token: { swid: '{00000001-0000-4000-8000-000000000001}' } }), null);
	assert.equal(findSession({ s2: S2, swid: 'not-a-swid' }), null);
	assert.equal(findSession(null), null);
	assert.equal(findSession('s2'), null);
});

void test('a final message from the sign-in window is read by its outcome, any other is not one', () => {
	const login = {
		login: { token: { swid: '00000001-0000-4000-8000-000000000001' } },
		guest: { s2: S2 }
	};
	const seen = ['init-signed-in'];
	assert.deepEqual(
		readMessage({ kind: 'commish-espn', outcome: 'signed-in', payload: login, seen }),
		{
			seen,
			outcome: {
				kind: 'session',
				session: { swid: '{00000001-0000-4000-8000-000000000001}', s2: S2 }
			}
		}
	);
	assert.deepEqual(readMessage({ kind: 'commish-espn', outcome: 'signed-in', payload: {}, seen }), {
		seen,
		outcome: { kind: 'no-session' }
	});
	assert.deepEqual(readMessage({ kind: 'commish-espn', outcome: 'closed' }), {
		seen: [],
		outcome: { kind: 'closed' }
	});
	assert.deepEqual(readMessage({ kind: 'commish-espn', outcome: 'failed', seen: [] }), {
		seen: [],
		outcome: { kind: 'failed' }
	});
	assert.equal(readMessage({ kind: 'other', outcome: 'closed' }), null);
	assert.equal(readMessage({ kind: 'commish-espn', outcome: 'unheard-of' }), null);
	assert.equal(readMessage('closed'), null);
});

void test("an error carries the widget's own reason, cut short and kept to plain text", () => {
	assert.deepEqual(
		readMessage({
			kind: 'commish-espn',
			outcome: 'error',
			reason: 'Session already established',
			seen: ['init-signed-out']
		}),
		{
			seen: ['init-signed-out'],
			outcome: { kind: 'error', reason: 'Session already established' }
		}
	);
	const long = readMessage({ kind: 'commish-espn', outcome: 'error', reason: 'x'.repeat(500) });
	assert.deepEqual(long?.outcome, { kind: 'error', reason: 'x'.repeat(120) });
	assert.deepEqual(readMessage({ kind: 'commish-espn', outcome: 'error', reason: 7 })?.outcome, {
		kind: 'error',
		reason: 'no reason given'
	});
});

void test('a progress message carries only the events seen, and an unknown event name is dropped', () => {
	assert.deepEqual(
		readMessage({
			kind: 'commish-espn',
			outcome: 'seen',
			seen: ['init-signed-in', 'logout', 'refresh', { name: 'login' }, 'login']
		}),
		{ seen: ['init-signed-in', 'logout', 'login'], outcome: null }
	);
});

void test('the account page reads a message only from its sign-in window on the sign-in origin', () => {
	const opened = {};
	const data = { kind: 'commish-espn', outcome: 'closed' };
	assert.deepEqual(
		fromSignInWindow({ origin: ESPN_SIGN_IN_ORIGIN, source: opened, data }, opened),
		{ seen: [], outcome: { kind: 'closed' } }
	);
	for (const origin of [SITE_ORIGIN, 'https://evil.example', 'null']) {
		assert.equal(fromSignInWindow({ origin, source: opened, data }, opened), null, origin);
	}
	assert.equal(fromSignInWindow({ origin: ESPN_SIGN_IN_ORIGIN, source: {}, data }, opened), null);
	assert.equal(fromSignInWindow({ origin: ESPN_SIGN_IN_ORIGIN, source: null, data }, null), null);
});
