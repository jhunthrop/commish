// The account's attached leagues across a Detach, its Undo and the drop after it (B72): the list
// both Account tables read. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AttachedLeague } from './api.ts';
import {
	UNREAD_ATTACHED,
	dropDetached,
	liveLeagues,
	markDetached,
	readFailed,
	readList,
	unmarkDetached
} from './attached-state.ts';

const READ_AT = Date.parse('2026-10-19T23:41:00.000Z');

function league(id: string, name: string): AttachedLeague {
	return {
		id,
		host: 'espn',
		host_league_id: id,
		season: 2026,
		name,
		roster_id: 1,
		team_name: 'My Ball Zach Ertz',
		standing: { wins: 2, losses: 3, ties: 0, place: 8, teams: 12 },
		attached_at: '2026-10-13T12:00:00.000Z',
		last_read_at: '2026-10-19T23:37:00.000Z',
		phase: 'in_season',
		phase_basis: '',
		draft_at: null,
		playoff_start_week: 15,
		waivers_open: true
	};
}

const ESPN = league('espn-1', 'A League of Their Own');
const FFPC = league('ffpc-1', 'Big Gorilla Tourney');
const read = readList(UNREAD_ATTACHED, [ESPN, FFPC], READ_AT);
const ids = (leagues: readonly AttachedLeague[] | null): string[] | null =>
	leagues === null ? null : leagues.map((l) => l.id);

void test('before the read there is no list, and a read lands with its clock', () => {
	assert.equal(liveLeagues(UNREAD_ATTACHED), null);
	assert.deepEqual(ids(liveLeagues(read)), ['espn-1', 'ffpc-1']);
	assert.equal(read.readAt, READ_AT);
	assert.equal(read.failed, false);
});

void test('a detached league leaves the live list at once and keeps its row for the undo', () => {
	const detached = markDetached(read, 'espn-1');
	assert.deepEqual(ids(liveLeagues(detached)), ['ffpc-1']);
	assert.deepEqual(ids(detached.leagues), ['espn-1', 'ffpc-1']);
	assert.deepEqual(detached.detached, ['espn-1']);
	assert.equal(markDetached(detached, 'espn-1'), detached, 'a second detach marks nothing more');
});

void test('an undo puts the league back on the live list', () => {
	const undone = unmarkDetached(markDetached(read, 'espn-1'), 'espn-1');
	assert.deepEqual(ids(liveLeagues(undone)), ['espn-1', 'ffpc-1']);
	assert.deepEqual(undone.detached, []);
});

void test('the drop after the undo window takes the detached league off the list', () => {
	const dropped = dropDetached(markDetached(read, 'espn-1'), 'espn-1');
	assert.deepEqual(ids(dropped.leagues), ['ffpc-1']);
	assert.deepEqual(ids(liveLeagues(dropped)), ['ffpc-1']);
	assert.deepEqual(dropped.detached, []);
});

void test('a drop for a detach taken back leaves the league on the list', () => {
	const undone = unmarkDetached(markDetached(read, 'espn-1'), 'espn-1');
	assert.equal(dropDetached(undone, 'espn-1'), undone);
	assert.deepEqual(ids(liveLeagues(undone)), ['espn-1', 'ffpc-1']);
});

void test('two detaches drop each on its own, and the steps never change the state they read', () => {
	const both = markDetached(markDetached(read, 'espn-1'), 'ffpc-1');
	assert.deepEqual(liveLeagues(both), []);
	const one = dropDetached(both, 'espn-1');
	assert.deepEqual(ids(one.leagues), ['ffpc-1']);
	assert.deepEqual(one.detached, ['ffpc-1']);
	assert.deepEqual(ids(read.leagues), ['espn-1', 'ffpc-1']);
	assert.deepEqual(read.detached, []);
});

void test('a read again keeps a detach waiting on its undo, and a failed read keeps the list', () => {
	const again = readList(markDetached(read, 'espn-1'), [ESPN, FFPC], READ_AT + 60_000);
	assert.deepEqual(ids(liveLeagues(again)), ['ffpc-1']);
	const failed = readFailed(read);
	assert.equal(failed.failed, true);
	assert.deepEqual(ids(liveLeagues(failed)), ['espn-1', 'ffpc-1']);
});
