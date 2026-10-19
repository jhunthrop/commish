// The Account room's Platforms table (Lane 66k): each platform's row from GET /hosts, Sleeper's a
// fixed fact. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { components } from '#lib/api/types.ts';
import {
	PLATFORMS,
	PLATFORM_WORDS,
	platformRows,
	readWords,
	type PlatformRow
} from './platform-rows.ts';

type HostConnection = components['schemas']['HostConnection'];
const NOW = new Date('2026-10-17T15:12:00.000Z');

function rowOf(rows: readonly PlatformRow[], key: PlatformRow['key']): PlatformRow {
	const row = rows.find((r) => r.key === key);
	if (!row) throw new Error(`no ${key} row`);
	return row;
}

const conn = (over: Partial<HostConnection> & Pick<HostConnection, 'host'>): HostConnection => ({
	status: 'connected',
	proven: true,
	connected_at: '2026-10-03T12:00:00.000Z',
	last_read_at: '2026-10-17T15:06:00.000Z',
	consent_version: 3,
	writes_on: false,
	writes_reason: null,
	...over
});

void test('every platform has its row, in the table order, Sleeper as a fixed fact', () => {
	const rows = platformRows({ enabled: [], connections: [] }, NOW);
	assert.deepEqual(
		rows.map((r) => r.key),
		[...PLATFORMS]
	);
	const espn = rowOf(rows, 'espn');
	const sleeper = rowOf(rows, 'sleeper');
	assert.equal(sleeper.note, 'Followed by league id, nothing to connect');
	assert.deepEqual([sleeper.state, sleeper.line], ['No sign-in', 'Leagues read in public']);
	assert.equal(sleeper.verb?.kind, 'follow');
	assert.equal(espn.state, PLATFORM_WORDS.notOpen);
	assert.equal(espn.verb, null);
});

void test('a connection reads its state, consent, writes and last read from the API', () => {
	const rows = platformRows(
		{
			enabled: ['espn', 'yahoo', 'mfl', 'ffpc'],
			connections: [
				conn({
					host: 'espn',
					writes_reason: 'Lineups on ESPN are not open to your account yet.'
				}),
				conn({
					host: 'mfl',
					consent_version: 1,
					writes_on: true,
					connected_at: '2026-10-15T12:00:00.000Z',
					last_read_at: '2026-10-17T13:12:00.000Z'
				}),
				conn({
					host: 'ffpc',
					status: 'signed_out',
					connected_at: '2026-09-28T12:00:00.000Z',
					last_read_at: '2026-10-12T12:00:00.000Z'
				})
			]
		},
		NOW
	);
	const espn = rowOf(rows, 'espn');
	const yahoo = rowOf(rows, 'yahoo');
	const mfl = rowOf(rows, 'mfl');
	const ffpc = rowOf(rows, 'ffpc');
	assert.deepEqual(
		[espn.state, espn.line, espn.writes, espn.read, espn.verb?.words],
		[
			'Connected',
			'Since Oct 3, consent version 3',
			{ on: false, words: 'Lineups on ESPN are not open to your account yet.' },
			'6 minutes ago',
			'Disconnect'
		]
	);
	assert.deepEqual(
		[yahoo.state, yahoo.verb?.kind, yahoo.writes],
		['Not connected', 'connect', null]
	);
	assert.deepEqual(mfl.writes, { on: true, words: PLATFORM_WORDS.onWords });
	assert.equal(mfl.read, '2 hours ago');
	assert.deepEqual(
		[ffpc.dot, ffpc.state, ffpc.read, ffpc.verb],
		['bad', 'Signed out by FFPC', 'Oct 12', { kind: 'again', words: 'Sign in to FFPC again' }]
	);
});

void test('a read never made says so', () => {
	assert.equal(readWords(null, NOW), '--');
});

void test('the copy guard: no em-dash, semicolon or platform word in the table', () => {
	const rows = platformRows({ enabled: ['yahoo'], connections: [] }, NOW);
	const said = [...Object.values(PLATFORM_WORDS), ...rows.flatMap((r) => [r.state, r.line])];
	for (const s of said) assert.doesNotMatch(s, bannedPattern(), s);
});

void test('a re-read after a disconnect draws at its own instant: a 30-minute-old read says so (review 77)', () => {
	// The page opened at 10:00, ESPN was read at 10:30, FFPC was disconnected at 11:00 and the table
	// read again. Said against the page's open the read would be "just now"; against the re-read it is
	// its true age.
	const opened = new Date('2026-10-17T15:00:00.000Z');
	const reread = new Date('2026-10-17T16:00:00.000Z');
	const hosts = {
		enabled: ['espn' as const],
		connections: [conn({ host: 'espn', last_read_at: '2026-10-17T15:30:00.000Z' })]
	};
	assert.equal(rowOf(platformRows(hosts, reread), 'espn').read, '30 minutes ago');
	assert.equal(rowOf(platformRows(hosts, opened), 'espn').read, 'just now');
});
