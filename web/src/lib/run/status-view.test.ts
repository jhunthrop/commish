// A listed player's row, page and record words (Lane 63): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BUILT_ZONE,
	boardStatusWords,
	playerStatusWords,
	statusView,
	weekNote,
	type Saying
} from './status-view.ts';
import { playerStatusSchema } from './schema.ts';

const LISTED = '2026-10-16T14:05:00.000Z';
const CENTRAL: Saying = {
	capture: { readAt: LISTED, checkedAt: '2026-10-16T15:05:00.000Z' },
	restOfSeason: true,
	zone: 'America/Chicago',
	now: Date.parse('2026-10-16T16:00:00.000Z')
};

void test('a season-long status shows as his rank, its chip says since when, its line why he sits below', () => {
	assert.deepEqual(
		statusView(
			{ status: 'injured_reserve', seasonLong: true, since: '2026-10-14T15:00:00.000Z' },
			CENTRAL
		),
		{
			rank: 'IR',
			mark: 'IR since Oct 14',
			sits: true,
			line: 'On injured reserve since October 14. Our rest-of-season figure assumes he plays, so he sits below the available players.'
		}
	);
});

void test('designated to return: due back this week is the week’s question, a later day is said on the list (Lane 153)', () => {
	const mason = {
		status: 'questionable' as const,
		seasonLong: false,
		since: null,
		returning: '2026-10-25'
	};
	assert.deepEqual(statusView(mason, CENTRAL), {
		rank: null,
		mark: 'Due back Sun Oct 25',
		sits: false,
		line: null,
		question: true
	});
	assert.equal(
		weekNote(mason),
		'Expected back Sun Oct 25 on the latest report, which does not move his place on our board.'
	);
	const later = {
		status: 'injured_reserve' as const,
		seasonLong: true,
		since: '2026-09-22T15:00:00.000Z',
		returning: '2026-11-08'
	};
	const view = statusView(later, CENTRAL);
	assert.equal(view.mark, 'IR, back Nov 8');
	assert.equal(view.rank, 'IR');
	assert.ok(
		playerStatusWords(later, CENTRAL).note.startsWith('On injured reserve since September 22.')
	);
	// The file carries the day only for a return the rule read: questionable this week, else a list.
	assert.equal(playerStatusSchema.safeParse(mason).success, true);
	assert.equal(playerStatusSchema.safeParse(later).success, true);
	assert.equal(playerStatusSchema.safeParse({ ...mason, status: 'out' }).success, false);
	assert.equal(playerStatusSchema.safeParse({ ...mason, returning: '20261025' }).success, false);
	// An older file, with no day, reads as before.
	const older = { status: mason.status, seasonLong: mason.seasonLong, since: mason.since };
	assert.equal(statusView(older, CENTRAL).mark, 'Questionable');
});

void test('a week’s designation keeps his rank and its chip is the word, as the league rows say it', () => {
	assert.deepEqual(statusView({ status: 'doubtful', seasonLong: false, since: null }, CENTRAL), {
		rank: null,
		mark: 'Doubtful',
		sits: false,
		line: null
	});
	assert.equal(statusView({ status: 'out', seasonLong: false, since: null }, CENTRAL).sits, true);
	assert.equal(
		weekNote({ status: 'doubtful', seasonLong: false, since: null }),
		'Doubtful on the latest report, which does not move his place on our board.'
	);
});

void test('a board and a page built on the Eastern clock and said again on the member’s', () => {
	const rows = [
		{ id: 'ir', status: { status: 'injured_reserve', seasonLong: true, since: null } as const },
		{ id: 'free' }
	];
	const built = boardStatusWords(rows, { ...CENTRAL, zone: BUILT_ZONE });
	// A page of board rows says the capture in the few words its basis has left (Lane 66n), the hour
	// on the reader's own day (Lane 280).
	assert.equal(built.capture, 'Status read today 11:05 am ET.');
	assert.deepEqual(Object.keys(built.rows), ['ir']);
	assert.equal(boardStatusWords(rows, CENTRAL).capture, 'Status read today 10:05 am CT.');
	assert.equal(
		playerStatusWords({ status: 'doubtful', seasonLong: false, since: null }, CENTRAL).note,
		'Doubtful on the latest report, which does not move his place on our board. Injury status from the hourly capture, read Fri Oct 16, 10:05 am CT.'
	);
});
