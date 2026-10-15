// What the account page says when Disney's sign-in hands nothing over, and what Disney did, in
// plain words: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALREADY_SIGNED_IN_LINE } from './espn-window.ts';
import { problemOf, seenWords } from './espn-signin-words.ts';

void test('a session, or the member closing the window, says nothing', () => {
	assert.equal(problemOf({ kind: 'session', session: { swid: '{a}', s2: 'b' } }), null);
	assert.equal(problemOf({ kind: 'closed' }), null);
});

void test('each way of handing nothing over has its own sentence, the error in its own words', () => {
	const nothing = problemOf({ kind: 'nothing' });
	const noSession = problemOf({ kind: 'no-session' });
	const failed = problemOf({ kind: 'failed' });
	const error = problemOf({ kind: 'error', reason: 'Session already established' });
	assert.ok(nothing?.includes('closed without handing anything back'));
	assert.ok(error?.includes('"Session already established"'));
	assert.equal(new Set([nothing, noSession, failed, error]).size, 4);
	for (const sentence of [nothing, noSession, failed, error]) {
		assert.ok(sentence?.endsWith('Paste the two values below instead.'), sentence ?? '');
	}
});

void test('the events seen name the branch', () => {
	assert.equal(
		seenWords(['init-signed-in']),
		'Disney said you were already signed in and handed nothing back.'
	);
	assert.equal(
		seenWords(['init-signed-out', 'login']),
		'Disney said you were signed out, then saw you sign in and handed nothing back.'
	);
	assert.equal(
		seenWords(['init-signed-in', 'logout', 'error']),
		'Disney said you were already signed in, then signed you out, then reported a problem and handed nothing back.'
	);
	assert.equal(seenWords([]), "Disney's sign-in never answered the window.");
});

void test('no word on the page or in the window uses an em-dash or a semicolon', () => {
	const words = [
		ALREADY_SIGNED_IN_LINE,
		problemOf({ kind: 'nothing' }),
		problemOf({ kind: 'no-session' }),
		problemOf({ kind: 'failed' }),
		problemOf({ kind: 'error', reason: 'r' }),
		seenWords([]),
		seenWords(['init-signed-in', 'init-signed-out', 'login', 'logout', 'error'])
	];
	for (const word of words) {
		assert.ok(word !== null && !/[—;]/.test(word), word ?? '');
	}
});
