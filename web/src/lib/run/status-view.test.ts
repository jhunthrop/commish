// A listed player's row, page and record words (Lane 63): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import {
	BUILT_ZONE,
	HELD_OUT_METHOD,
	boardStatusWords,
	playerStatusWords,
	recordStatusWords,
	statusView,
	weekNote,
	type Saying
} from './status-view.ts';

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

void test('a week’s designation keeps his rank and its chip is the word, as the league rows say it', () => {
	assert.deepEqual(statusView({ status: 'doubtful', seasonLong: false, since: null }, CENTRAL), {
		rank: null,
		mark: 'Doubtful',
		sits: false,
		line: null
	});
	assert.equal(statusView({ status: 'out', seasonLong: false, since: null }, CENTRAL).sits, true);
	assert.equal(
		weekNote('doubtful'),
		'Doubtful on the latest report, which does not move his place on our board.'
	);
});

void test('the record says the frozen boards it grades moved no one', () => {
	assert.match(HELD_OUT_METHOD, /graded where the board froze\.$/u);
	assert.doesNotMatch(HELD_OUT_METHOD, bannedPattern());
	assert.equal(recordStatusWords(CENTRAL).endsWith(HELD_OUT_METHOD), true);
});

void test('a board and a page built on the Eastern clock and said again on the member’s', () => {
	const rows = [
		{ id: 'ir', status: { status: 'injured_reserve', seasonLong: true, since: null } as const },
		{ id: 'free' }
	];
	const built = boardStatusWords(rows, { ...CENTRAL, zone: BUILT_ZONE });
	// A page of board rows says the capture in the few words its basis has left (Lane 66n).
	assert.equal(built.capture, 'Status read Oct 16.');
	assert.deepEqual(Object.keys(built.rows), ['ir']);
	assert.equal(boardStatusWords(rows, CENTRAL).capture, 'Status read Oct 16.');
	assert.equal(
		playerStatusWords({ status: 'doubtful', seasonLong: false, since: null }, CENTRAL).note,
		'Doubtful on the latest report, which does not move his place on our board. Injury status from the hourly capture, read Fri Oct 16, 10:05 am Central.'
	);
});
