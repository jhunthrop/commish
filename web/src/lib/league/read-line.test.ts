// A league read as a member is read with that member's own sign-in alone, so a lapsed read asks the
// drafter to connect, never says no one in the league is: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLine } from './model.ts';

const now = new Date('2026-10-15T12:10:00Z');
const read = {
	host: 'ffpc' as const,
	read_at: '2026-10-15T12:00:00Z',
	host_signed_out: true,
	host_failed: true,
	host_stale_seconds: 600
};

void test('a member read that lapsed asks the drafter to sign in or connect, in the platform word, with the last read', () => {
	assert.equal(
		readLine(read, now),
		'Sign in to FFPC to keep this league in sync. This is our last read, 10 minutes ago.'
	);
	assert.equal(
		readLine({ ...read, host: 'yahoo' }, now),
		'Connect Yahoo to keep this league in sync. This is our last read, 10 minutes ago.'
	);
});

void test('a host that is not answering says so', () => {
	assert.equal(
		readLine({ ...read, host_signed_out: false }, now),
		'FFPC is not answering. This is our last read, 10 minutes ago.'
	);
});
